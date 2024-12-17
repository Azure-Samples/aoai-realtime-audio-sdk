package com.azure.sample.openai.realtime.spring_backend.handlers;

import com.azure.ai.openai.realtime.RealtimeAsyncClient;
import com.azure.ai.openai.realtime.models.ConversationItemInputAudioTranscriptionCompletedEvent;
import com.azure.ai.openai.realtime.models.InputAudioBufferAppendEvent;
import com.azure.ai.openai.realtime.models.RealtimeAudioFormat;
import com.azure.ai.openai.realtime.models.RealtimeAudioInputTranscriptionModel;
import com.azure.ai.openai.realtime.models.RealtimeAudioInputTranscriptionSettings;
import com.azure.ai.openai.realtime.models.RealtimeClientEventResponseCreateResponse;
import com.azure.ai.openai.realtime.models.RealtimeRequestSession;
import com.azure.ai.openai.realtime.models.RealtimeRequestSessionModality;
import com.azure.ai.openai.realtime.models.RealtimeServerEvent;
import com.azure.ai.openai.realtime.models.RealtimeServerEventErrorError;
import com.azure.ai.openai.realtime.models.RealtimeServerVadTurnDetection;
import com.azure.ai.openai.realtime.models.RealtimeVoice;
import com.azure.ai.openai.realtime.models.ResponseAudioDeltaEvent;
import com.azure.ai.openai.realtime.models.ResponseAudioDoneEvent;
import com.azure.ai.openai.realtime.models.ResponseAudioTranscriptDeltaEvent;
import com.azure.ai.openai.realtime.models.ResponseAudioTranscriptDoneEvent;
import com.azure.ai.openai.realtime.models.ResponseCreateEvent;
import com.azure.ai.openai.realtime.models.ServerErrorReceivedException;
import com.azure.ai.openai.realtime.models.SessionUpdateEvent;
import com.azure.ai.openai.realtime.utils.ConversationItem;
import com.azure.sample.openai.realtime.spring_backend.messages.ControlMessage;
import com.azure.sample.openai.realtime.spring_backend.messages.TextDeltaMessage;
import com.azure.sample.openai.realtime.spring_backend.messages.TranscriptionMessage;
import com.azure.sample.openai.realtime.spring_backend.messages.UserMessage;
import com.fasterxml.jackson.databind.ObjectMapper;
import jakarta.annotation.PostConstruct;
import jakarta.annotation.PreDestroy;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Controller;
import org.springframework.web.socket.BinaryMessage;
import org.springframework.web.socket.CloseStatus;
import org.springframework.web.socket.TextMessage;
import org.springframework.web.socket.WebSocketSession;
import org.springframework.web.socket.handler.TextWebSocketHandler;
import reactor.core.Disposable;
import reactor.core.Disposables;
import reactor.core.publisher.Flux;

import java.io.IOException;
import java.util.Arrays;

@Controller
public class RealtimeAudioHandler extends TextWebSocketHandler {

    private static final Logger logger = LoggerFactory.getLogger(RealtimeAudioHandler.class);
    private final ObjectMapper objectMapper = new ObjectMapper();
    private final Disposable.Composite disposables = Disposables.composite();
    private WebSocketSession currentSession = null;

    private final RealtimeAsyncClient realtimeAsyncClient;

    public RealtimeAudioHandler(RealtimeAsyncClient realtimeAsyncClient) {
        this.realtimeAsyncClient = realtimeAsyncClient;
    }

    @PostConstruct
    public void init() {
        logger.atInfo().log("Starting RealtimeAsyncClient");
        this.realtimeAsyncClient.start().block();
        realtimeAsyncClient.sendMessage(new SessionUpdateEvent(new RealtimeRequestSession()
                .setInputAudioFormat(RealtimeAudioFormat.PCM16)
                .setModalities(Arrays.asList(RealtimeRequestSessionModality.AUDIO, RealtimeRequestSessionModality.TEXT))
                .setInputAudioTranscription(new RealtimeAudioInputTranscriptionSettings()
                        .setModel(RealtimeAudioInputTranscriptionModel.WHISPER_1))
                .setTurnDetection(new RealtimeServerVadTurnDetection())
                .setVoice(RealtimeVoice.ALLOY)
        )).block();
        logger.atInfo().log("RealtimeAsyncClient started");
    }

    @PreDestroy
    public void destroy() {
        logger.atInfo().log("Closing RealtimeAsyncClient");
        this.realtimeAsyncClient.stop().block();
        disposables.dispose();
        logger.atInfo().log("RealtimeAsyncClient closed");
    }

    @Override
    public void afterConnectionEstablished(WebSocketSession session) throws Exception {
        logger.atInfo().log("Connection established: " + session.getId());
        this.currentSession = session;

        ControlMessage controlMessage = new ControlMessage("connected")
                .setGreeting("You are now connected to the Spring Boot server");
        session.sendMessage(new TextMessage(objectMapper.writeValueAsString(controlMessage)));

        startEventLoop();
    }

    @Override
    public void afterConnectionClosed(WebSocketSession session, CloseStatus status) throws Exception {
        super.afterConnectionClosed(session, status);
        logger.atInfo().log("Connection closed: " + session.getId());
        logger.atInfo().log("Close status: " + status);
        disposables.dispose();
    }

    @Override
    protected void handleTextMessage(WebSocketSession session, TextMessage message) throws Exception {
        System.out.println("Message received");
        UserMessage userMessage = objectMapper.readValue(message.getPayload(), UserMessage.class);
        disposables.add(realtimeAsyncClient.sendMessage(ConversationItem.createUserMessage(userMessage.getText()))
                .then(realtimeAsyncClient.sendMessage(new ResponseCreateEvent(
                        new RealtimeClientEventResponseCreateResponse())))
                .subscribe());
    }

    @Override
    protected void handleBinaryMessage(WebSocketSession session, BinaryMessage message) {
        logger.atInfo().log("Binary message received");
        disposables.add(realtimeAsyncClient.sendMessage(
                new InputAudioBufferAppendEvent(message.getPayload().array()))
            .subscribe());
    }

    @Override
    public void handleTransportError(WebSocketSession session, Throwable exception) throws Exception {
        logger.atError().setCause(exception).log("Transport error");
        super.handleTransportError(session, exception);
    }

    private void startEventLoop() {
        disposables.addAll(Arrays.asList(
                getLooperFlux().ofType(ResponseAudioTranscriptDeltaEvent.class)
                        .subscribe(this::handleTranscriptionDelta),
                getLooperFlux().ofType(ResponseAudioTranscriptDoneEvent.class)
                        .subscribe(this::handleTranscriptionDone),
                getLooperFlux().ofType(ResponseAudioDeltaEvent.class)
                        .subscribe(this::handleAudioDelta),
                getLooperFlux().ofType(ResponseAudioDoneEvent.class)
                        .subscribe(this::handleAudioDone),
                getLooperFlux().ofType(ConversationItemInputAudioTranscriptionCompletedEvent.class)
                        .subscribe(this::handleInputAudio)
        ));
    }

    private void handleInputAudio(ConversationItemInputAudioTranscriptionCompletedEvent inputAudioEvent) {
        try {
            String payload = objectMapper.writeValueAsString(new ControlMessage("speech_started"));
            currentSession.sendMessage(new TextMessage(payload));
            TranscriptionMessage transcription = new TranscriptionMessage(inputAudioEvent.getItemId())
                    .setText(inputAudioEvent.getTranscript());
            currentSession.sendMessage(new TextMessage(objectMapper.writeValueAsString(transcription)));
            logger.atInfo().log("Input audio successfully processed of length: " + inputAudioEvent.getTranscript().length());
        } catch (IOException e) {
            logger.atError().setCause(e).log("Error sending speech started message");
        }
    }

    private void handleAudioDone(ResponseAudioDoneEvent audioDoneEvent) {
        logger.atInfo().log("Audio done event received");
        // no-op
    }

    private void handleAudioDelta(ResponseAudioDeltaEvent audioDeltaEvent) {
        logger.atInfo().log("New audio delta inbound");
        try {
            currentSession.sendMessage(new BinaryMessage(audioDeltaEvent.getDelta()));
        } catch (IOException e) {
            logger.atError().setCause(e).log("Error sending audio delta message");
        }
    }

    private void handleTranscriptionDone(ResponseAudioTranscriptDoneEvent transcriptDoneEvent) {
        String contentId = transcriptDoneEvent.getItemId() + "-" + transcriptDoneEvent.getContentIndex();
        logger.atInfo().log("Transcription done event received for contentId: " + contentId);
        try {
            String payload = objectMapper.writeValueAsString(new ControlMessage("done")
                    .setId(contentId));
            this.currentSession.sendMessage(new TextMessage(payload));
        } catch (Exception e) {
            logger.atError().setCause(e).log("Error sending done message");
        }
    }

    private void handleTranscriptionDelta(ResponseAudioTranscriptDeltaEvent textDelta) {
        String contentId = textDelta.getItemId() + "-" + textDelta.getContentIndex();
        logger.atInfo().log("New text delta inbound. Assigned contentId: " + contentId);
        TextDeltaMessage textDeltaMessage = new TextDeltaMessage(contentId, textDelta.getDelta());
        try {
            this.currentSession.sendMessage(new TextMessage(objectMapper.writeValueAsString(textDeltaMessage)));
        } catch (Exception e) {
            logger.atError().setCause(e).log("Error sending text delta message");
        }
    }

    private Flux<RealtimeServerEvent> getLooperFlux() {
        return realtimeAsyncClient.getServerEvents().onErrorResume((throwable) -> {
            // Log the error and continue listening for events.
            if (throwable instanceof ServerErrorReceivedException) {
                ServerErrorReceivedException error = (ServerErrorReceivedException) throwable;
                RealtimeServerEventErrorError errorDetails = error.getErrorDetails();
                logger.atError().setCause(throwable)
                        .addKeyValue("eventId", errorDetails.getEventId())
                        .addKeyValue("code", String.valueOf(errorDetails.getCode()))
                        .addKeyValue("message", errorDetails.getMessage())
                        .addKeyValue("type", errorDetails.getType())
                        .addKeyValue("param", errorDetails.getParam())
                        .log("Received a ServerErrorReceivedException");
                logger.atError().log("Error message: " + errorDetails.getMessage());
            } else {
                logger.atError().setCause(throwable).log("Error sent from the Realtime server");
            }
            // TODO resend session config.
            // errors with eventId is defined is not a terminal error.
            return realtimeAsyncClient.getServerEvents();
        });
    }
}
