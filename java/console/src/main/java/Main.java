import java.io.ByteArrayInputStream;
import java.io.File;
import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.Paths;
import java.nio.file.StandardOpenOption;
import java.util.Arrays;

import javax.sound.sampled.AudioFileFormat;
import javax.sound.sampled.AudioFormat;
import javax.sound.sampled.AudioInputStream;
import javax.sound.sampled.AudioSystem;

import com.azure.ai.openai.realtime.RealtimeAsyncClient;
import com.azure.ai.openai.realtime.RealtimeClientBuilder;
import com.azure.ai.openai.realtime.models.InputAudioBufferAppendEvent;
import com.azure.ai.openai.realtime.models.RealtimeAudioInputTranscriptionModel;
import com.azure.ai.openai.realtime.models.RealtimeAudioInputTranscriptionSettings;
import com.azure.ai.openai.realtime.models.RealtimeRequestSession;
import com.azure.ai.openai.realtime.models.RealtimeRequestSessionModality;
import com.azure.ai.openai.realtime.models.RealtimeServerEventErrorError;
import com.azure.ai.openai.realtime.models.RealtimeServerVadTurnDetection;
import com.azure.ai.openai.realtime.models.RealtimeVoice;
import com.azure.ai.openai.realtime.models.ResponseAudioDeltaEvent;
import com.azure.ai.openai.realtime.models.ResponseAudioDoneEvent;
import com.azure.ai.openai.realtime.models.ResponseAudioTranscriptDeltaEvent;
import com.azure.ai.openai.realtime.models.ResponseAudioTranscriptDoneEvent;
import com.azure.ai.openai.realtime.models.ResponseDoneEvent;
import com.azure.ai.openai.realtime.models.ServerErrorReceivedException;
import com.azure.ai.openai.realtime.models.SessionCreatedEvent;
import com.azure.ai.openai.realtime.models.SessionUpdateEvent;
import com.azure.core.credential.AzureKeyCredential;
import com.azure.core.credential.KeyCredential;
import com.azure.core.util.Configuration;

import reactor.core.Disposable;
import reactor.core.Disposables;
import reactor.core.publisher.Mono;

public class Main {
    private static final String AUDIO_RESPONSE_DATA_FILE = "audio_response.data";
    private static final String AUDIO_RESPONSE_WAV_FILE = "audio_response.wav";

    public static void main(String[] args) {
        AudioFile audioFile = new AudioFile(Paths.get("whats_the_weather_pcm16_24khz_mono.wav"))
                .setBytesPerSample(16)
                .setSampleRate(24000);

        RealtimeAsyncClient client = buildClient(true);

        // We have a composite disposable to collect our subscriptions
        Disposable.Composite disposables = Disposables.composite();

        // Set up event consumers for our server events of interest:
        // - SessionCreatedEvent
        // - ResponseAudioDeltaEvent
        // - ResponseAudioTranscriptDeltaEvent
        disposables.addAll(Arrays.asList(
                client.getServerEvents()
                        .takeUntil(serverEvent -> serverEvent instanceof SessionCreatedEvent)
                        .ofType(SessionCreatedEvent.class)
                        .subscribe(Main::consumeSessionCreated, Main::consumeError),
                client.getServerEvents()
                        .takeUntil(serverEvent -> serverEvent instanceof ResponseAudioDoneEvent)
                        .ofType(ResponseAudioDeltaEvent.class)
                        .subscribe(Main::consumeAudioDelta, Main::consumeError, Main::onAudioResponseCompleted),
                client.getServerEvents()
                        .takeUntil(serverEvent -> serverEvent instanceof ResponseAudioTranscriptDoneEvent)
                        .ofType(ResponseAudioTranscriptDeltaEvent.class)
                        .subscribe(Main::consumeAudioTranscriptDelta, Main::consumeError,
                                Main::onAudioResponseTranscriptCompleted),
                client.getServerEvents()
                    .takeUntil(serverEvent -> serverEvent instanceof ResponseDoneEvent)
                    .ofType(ResponseDoneEvent.class)
                    .subscribe(Main::consumeResponseDone, Main::consumeError)));

        // Initializing connection to server
        client.start().block();

        // Configure the realtime session
        client.sendMessage(new SessionUpdateEvent(
                new RealtimeRequestSession()
                        .setVoice(RealtimeVoice.ALLOY)
                        .setTurnDetection(
                                new RealtimeServerVadTurnDetection()
                                        .setThreshold(0.5)
                                        .setPrefixPaddingMs(300)
                                        .setSilenceDurationMs(200))
                        .setInputAudioTranscription(new RealtimeAudioInputTranscriptionSettings(
                                RealtimeAudioInputTranscriptionModel.WHISPER_1))
                        .setModalities(Arrays.asList(RealtimeRequestSessionModality.AUDIO,
                                RealtimeRequestSessionModality.TEXT))))
                .block();

        // Send audio file with our prompt
        sendAudioFileAsync(client, audioFile).block();

        try {
            // We wait for the "response done" event, as this example only demonstrates one response
            client.getServerEvents().ofType(ResponseDoneEvent.class).take(1).blockLast();
            client.stop().block();
            client.close();
            disposables.dispose();

            // File cleanup. Comment out these lines if you want to preserve the audio
            // response files.
            Files.deleteIfExists(Paths.get(AUDIO_RESPONSE_DATA_FILE));
            Files.deleteIfExists(Paths.get(AUDIO_RESPONSE_WAV_FILE));
        } catch (Exception e) {
            System.out.println(e.getMessage());
        }
    }

    /**
     * Builds a RealtimeAsyncClient based on the configuration settings defined in
     * the environment variables.
     * 
     * @param isAzure is set to `true` will build the client assuming an Azure
     *                backend, whereas `false` builds the client
     *                for the OpenAI backend.
     * @return an instance of {@link RealtimeAsyncClient}.
     */
    private static RealtimeAsyncClient buildClient(boolean isAzure) {
        if (isAzure) {
            String azureOpenaiKey = Configuration.getGlobalConfiguration().get("AZURE_OPENAI_API_KEY");
            String endpoint = Configuration.getGlobalConfiguration().get("AZURE_OPENAI_ENDPOINT");
            String deploymentOrModelId = Configuration.getGlobalConfiguration().get("MODEL_OR_DEPLOYMENT_NAME");

            return new RealtimeClientBuilder()
                    .endpoint(endpoint)
                    .deploymentOrModelName(deploymentOrModelId)
                    .credential(new AzureKeyCredential(azureOpenaiKey))
                    .buildAsyncClient();
        } else {
            String openaiKey = Configuration.getGlobalConfiguration().get("OPENAI_KEY");
            String modelName = Configuration.getGlobalConfiguration().get("OPENAI_MODEL");

            return new RealtimeClientBuilder()
                    .credential(new KeyCredential(openaiKey))
                    .deploymentOrModelName(modelName)
                    .buildAsyncClient();
        }
    }

    /**
     * Consumes the audio delta sent by the server containing a chunk of audio data
     * in base64 encoded format.
     * We append each chunk of audio data to a file
     * {@link #AUDIO_RESPONSE_DATA_FILE}. This file does not contain WAV
     * header information, therefore it will not be recognized as an audio file.
     *
     * @param audioDelta The server sent delta containing a new chunk of audio data.
     */
    private static void consumeAudioDelta(ResponseAudioDeltaEvent audioDelta) {
        try {
            writeToFile(Paths.get(AUDIO_RESPONSE_DATA_FILE), audioDelta.getDelta());
        } catch (IOException e) {
            throw new RuntimeException(e);
        }
    }

    /**
     * Consumes the event sent by the server upon session establishment.
     * @param sessionCreated The information about the newly-started session.
     */
    private static void consumeSessionCreated(SessionCreatedEvent sessionCreated) {
        System.out.println("Connected: new session created with ID " + sessionCreated.getEventId());
    }

    /**
     * Callback triggered when the server signals that a full audio response has
     * been sent. We used the audio data chunks
     * collected in {@link #AUDIO_RESPONSE_DATA_FILE} to write a WAV file using the
     * default parameters for its format, and
     * write the file into {@link #AUDIO_RESPONSE_WAV_FILE}.
     */
    private static void onAudioResponseCompleted() {
        try {
            AudioFormat format = new AudioFormat(24000.0f, 16, 1, true, false);
            byte[] audioData = Files.readAllBytes(Paths.get(AUDIO_RESPONSE_DATA_FILE));

            File audioResponse = Paths.get(AUDIO_RESPONSE_WAV_FILE).toFile();
            AudioInputStream audioInputStream = new AudioInputStream(new ByteArrayInputStream(audioData), format,
                    audioData.length / format.getFrameSize());
            AudioSystem.write(audioInputStream, AudioFileFormat.Type.WAVE, audioResponse);
        } catch (IOException e) {
            System.out.println(e.getMessage());
        }
    }

    /**
     * Consumes the audio transcript delta sent by the server containing a chunk of
     * text transcript data. The piece of text
     * is directly printed to console, without the addition of line breaks.
     *
     * @param audioTranscriptDelta The server sent delta containing a new chunk of
     *                             text transcript data corresponding to
     *                             the audio file.
     */
    private static void consumeAudioTranscriptDelta(ResponseAudioTranscriptDeltaEvent audioTranscriptDelta) {
        System.out.print(audioTranscriptDelta.getDelta());
    }

    /**
     * Callback triggered when the server signals that the audio response transcript
     * has been completed.
     */
    private static void onAudioResponseTranscriptCompleted() {
        System.out.println("\nAudio transcript complete.");
    }

    /**
     * Consumes the response done event sent by the server when a single response generation is complete.
     * @param responseDoneEvent
     */
    private static void consumeResponseDone(ResponseDoneEvent responseDoneEvent) {
        System.out.println("\nResponse done.");
    }

    /**
     * Error handler. We are particularly interested in the
     * {@link ServerErrorReceivedException} which describes errors
     * sent by the server as an event, but mapped into an exception for ease of use.
     *
     * @param error The error that occurred while consuming the server sent events.
     */
    private static void consumeError(Throwable error) {
        if (error instanceof ServerErrorReceivedException) {
            ServerErrorReceivedException serverError = (ServerErrorReceivedException) error;
            RealtimeServerEventErrorError errorDetails = serverError.getErrorDetails();
            System.out.println("Error type: " + errorDetails.getType());
            System.out.println("Error code: " + errorDetails.getCode());
            System.out.println("Error parameter: " + errorDetails.getParam());
            System.out.println("Error message: " + errorDetails.getMessage());
        } else {
            System.out.println(error.getMessage());
        }
    }

    /**
     * Sends the audio file to the Realtime service in consecutive chunks. For async
     * usage.
     *
     * @param client    The Realtime async client.
     * @param audioFile A representation of the audio file to send
     * @return A Mono that signals success when it returns {@link Void}, or an error
     *         otherwise.
     */
    public static Mono<Void> sendAudioFileAsync(RealtimeAsyncClient client, AudioFile audioFile) {
        byte[] audioBytes;
        try {
            audioBytes = audioFile.getAudioFilesBytes();
        } catch (IOException e) {
            return Mono.error(e);
        }

        int samplesPerChunk = audioFile.getSampleRate() * audioFile.getChunkDurationMillis() / 1000;
        int bytesPerChunk = samplesPerChunk * audioFile.getBytesPerSample();
        for (int i = 0; i < audioBytes.length; i += bytesPerChunk) {
            int end = Math.min(audioBytes.length, i + bytesPerChunk);
            byte[] chunk = new byte[end - i];
            System.arraycopy(audioBytes, i, chunk, 0, end - i);
            client.sendMessage(new InputAudioBufferAppendEvent(chunk)).block();
        }

        return Mono.empty();
    }

    /**
     * Writes a byte array into a new file (if it doesn't exist) in append mode.
     *
     * @param destinationFile The path to the file to write to.
     * @param data            The data to write.
     * @throws IOException If an I/O error occurs while writing to the file.
     */
    public static void writeToFile(Path destinationFile, byte[] data) throws IOException {
        Files.write(destinationFile, data, StandardOpenOption.WRITE, StandardOpenOption.APPEND,
                StandardOpenOption.CREATE, StandardOpenOption.SYNC);
    }
}