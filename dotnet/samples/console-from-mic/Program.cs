using Azure.AI.OpenAI;
using Azure.Identity;
using OpenAI;
using OpenAI.Realtime;
using System.ClientModel;

#pragma warning disable OPENAI002

public class Program
{
    public static async Task Main(string[] args)
    {
        // First, we create a client according to configured environment variables (see end of file) and then start
        // a new conversation session.
        OpenAIClient topLevelServiceClient = GetTopLevelServiceClient();
        RealtimeClient realtimeClient = topLevelServiceClient.GetRealtimeClient();

        using RealtimeSession session = await realtimeClient.StartConversationSessionAsync(GetModelOrDeploymentName());

        // We'll add a simple function tool that enables the model to interpret user input to figure out when it
        // might be a good time to stop the interaction.
        ConversationFunctionTool finishConversationTool = new("user_wants_to_finish_conversation")
        {
            Description = "Invoked when the user says goodbye, expresses being finished, or otherwise seems to want to stop the interaction.",
            Parameters = BinaryData.FromString("{}")
        };

        // Now we configure the session using the tool we created along with transcription options that enable input
        // audio transcription with whisper.
        await session.ConfigureConversationSessionAsync(new ConversationSessionOptions()
        {
            Tools = { finishConversationTool },
            InputTranscriptionOptions = new()
            {
                Model = "whisper-1",
            },
        });

        // For convenience, we'll proactively start playback to the speakers now. Nothing will play until it's enqueued.
        SpeakerOutput speakerOutput = new();

        // With the session configured, we start processing commands received from the service.
        await foreach (RealtimeUpdate update in session.ReceiveUpdatesAsync())
        {
            // session.created is the very first command on a session and lets us know that connection was successful.
            if (update is ConversationSessionStartedUpdate)
            {
                Console.WriteLine($" <<< Connected: session started");
                // This is a good time to start capturing microphone input and sending audio to the service. The
                // input stream will be chunked and sent asynchronously, so we don't need to await anything in the
                // processing loop.
                _ = Task.Run(async () =>
                {
                    using MicrophoneAudioStream microphoneInput = MicrophoneAudioStream.Start();
                    Console.WriteLine($" >>> Listening to microphone input");
                    Console.WriteLine($" >>> (Just tell the app you're done to finish)");
                    Console.WriteLine();
                    await session.SendInputAudioAsync(microphoneInput);
                });
            }

            // input_audio_buffer.speech_started tells us that the beginning of speech was detected in the input audio
            // we're sending from the microphone.
            if (update is InputAudioSpeechStartedUpdate speechStartedUpdate)
            {
                Console.WriteLine($" <<< Start of speech detected @ {speechStartedUpdate.AudioStartTime}");
                // Like any good listener, we can use the cue that the user started speaking as a hint that the app
                // should stop talking. Note that we could also track the playback position and truncate the response
                // item so that the model doesn't "remember things it didn't say" -- that's not demonstrated here.
                speakerOutput.ClearPlayback();
            }

            // input_audio_buffer.speech_stopped tells us that the end of speech was detected in the input audio sent
            // from the microphone. It'll automatically tell the model to start generating a response to reply back.
            if (update is InputAudioSpeechFinishedUpdate speechFinishedUpdate)
            {
                Console.WriteLine($" <<< End of speech detected @ {speechFinishedUpdate.AudioEndTime}");
            }

            // conversation.item.input_audio_transcription.completed will only arrive if input transcription was
            // configured for the session. It provides a written representation of what the user said, which can
            // provide good feedback about what the model will use to respond.
            if (update is InputAudioTranscriptionFinishedUpdate transcriptionFinishedUpdate)
            {
                Console.WriteLine($" >>> USER: {transcriptionFinishedUpdate.Transcript}");
            }

            if (update is InputAudioTranscriptionDeltaUpdate deltaUpdate)
            {
                Console.Write(deltaUpdate.Delta);
            }

            if (update is OutputDeltaUpdate outputDeltaUpdate)
            {
                if (!string.IsNullOrEmpty(outputDeltaUpdate.Text))
                {
                    // If the model generates text, we print it to the console.
                    Console.Write(outputDeltaUpdate.Text);
                }
                if (outputDeltaUpdate.AudioBytes is not null)
                {
                    speakerOutput.EnqueueForPlayback(outputDeltaUpdate.AudioBytes);
                }
            }

            // response.output_item.done tells us that a model-generated item with streaming content is completed.
            // That's a good signal to provide a visual break and perform final evaluation of tool calls.
            if (update is OutputStreamingFinishedUpdate streamingFinishedUpdate)
            {
                Console.WriteLine();
                if (streamingFinishedUpdate.FunctionName == finishConversationTool.Name)
                {
                    Console.WriteLine($" <<< Finish tool invoked -- ending conversation!");
                    break;
                }
            }

            // error commands, as the name implies, are raised when something goes wrong.
            if (update is RealtimeErrorUpdate errorUpdate)
            {
                Console.WriteLine();
                Console.WriteLine();
                Console.WriteLine($" <<< ERROR: {errorUpdate.Message}");
                Console.WriteLine(errorUpdate.GetRawContent().ToString());
                break;
            }
        }
    }

    private static OpenAIClient GetTopLevelServiceClient()
    {
        string? aoaiEndpoint = Environment.GetEnvironmentVariable("AZURE_OPENAI_ENDPOINT");
        string? aoaiUseEntra = Environment.GetEnvironmentVariable("AZURE_OPENAI_USE_ENTRA");
        string? aoaiApiKey = Environment.GetEnvironmentVariable("AZURE_OPENAI_API_KEY");
        string? oaiApiKey = Environment.GetEnvironmentVariable("OPENAI_API_KEY");

        if (!string.IsNullOrEmpty(aoaiEndpoint))
        {
            Console.WriteLine($"AZURE_OPENAI_ENDPOINT is defined: configuring AzureOpenAIClient with endpoint: {aoaiEndpoint}");
            if (bool.TryParse(aoaiUseEntra, out bool useEntra) && useEntra)
            {
                Console.WriteLine($"AZURE_OPENAI_USE_ENTRA={aoaiUseEntra}: Using Entra token-based authentication");
                return new AzureOpenAIClient(new Uri(aoaiEndpoint), new DefaultAzureCredential());
            }
            else if (!string.IsNullOrEmpty(aoaiApiKey))
            {
                Console.WriteLine($"Using API key (AZURE_OPENAI_API_KEY): {aoaiApiKey[..5]}**");
                return new AzureOpenAIClient(new Uri(aoaiEndpoint), new ApiKeyCredential(aoaiApiKey));
            }
            else
            {
                throw new InvalidOperationException(
                    $"AZURE_OPENAI_ENDPOINT configured without AZURE_OPENAI_USE_ENTRA=true or AZURE_OPENAI_API_KEY.");
            }
        }
        else if (!string.IsNullOrEmpty(oaiApiKey))
        {
            Console.WriteLine($"OPENAI_API_KEY is defined: configuring OpenAIClient with API key: {oaiApiKey[..5]}**");
            return new OpenAIClient(new ApiKeyCredential(oaiApiKey));
        }
        else
        {
            throw new InvalidOperationException(
                $"No environment configuration present. Please provide one of:\n"
                    + " - AZURE_OPENAI_ENDPOINT with AZURE_OPENAI_USE_ENTRA=true or AZURE_OPENAI_API_KEY\n"
                    + " - OPENAI_API_KEY");
        }
    }

    private static string GetModelOrDeploymentName()
    {
        foreach (string environmentVariableKey in new List<string> { "AZURE_OPENAI_DEPLOYMENT", "OPENAI_MODEL" })
        {
            string? value = Environment.GetEnvironmentVariable(environmentVariableKey);
            if (!string.IsNullOrEmpty(value))
            {
                Console.WriteLine($"Using model/deployment from variable {environmentVariableKey}: {value}");
                return value;
            }
        }

        throw new InvalidOperationException(
            $"No model or deployment name configured. Please provide one of:\n"
                + " - AZURE_OPENAI_DEPLOYMENT\n"
                + " - OPENAI_MODEL");
    }
}
