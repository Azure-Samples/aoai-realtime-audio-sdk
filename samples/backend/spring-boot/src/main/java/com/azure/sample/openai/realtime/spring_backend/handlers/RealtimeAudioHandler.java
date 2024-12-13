package com.azure.sample.openai.realtime.spring_backend.handlers;

import com.azure.ai.openai.realtime.RealtimeAsyncClient;
import com.azure.ai.openai.realtime.models.RealtimeAudioFormat;
import com.azure.ai.openai.realtime.models.RealtimeAudioInputTranscriptionModel;
import com.azure.ai.openai.realtime.models.RealtimeAudioInputTranscriptionSettings;
import com.azure.ai.openai.realtime.models.RealtimeRequestSession;
import com.azure.ai.openai.realtime.models.RealtimeRequestSessionModality;
import com.azure.ai.openai.realtime.models.RealtimeServerVadTurnDetection;
import com.azure.ai.openai.realtime.models.RealtimeVoice;
import com.azure.ai.openai.realtime.models.SessionUpdateEvent;
import com.azure.sample.openai.realtime.spring_backend.messages.ControlMessage;
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

import java.util.Arrays;

@Controller
public class RealtimeAudioHandler extends TextWebSocketHandler {

    private static final Logger logger = LoggerFactory.getLogger(RealtimeAudioHandler.class);
    private final ObjectMapper objectMapper = new ObjectMapper();
    private final Disposable.Composite disposables = Disposables.composite();

    private final RealtimeAsyncClient realtimeAsyncClient;

    public RealtimeAudioHandler(RealtimeAsyncClient realtimeAsyncClient) {
        this.realtimeAsyncClient = realtimeAsyncClient;
    }

    @PostConstruct
    public void init() {
        logger.atInfo().log("Starting RealtimeAsyncClient");
        this.realtimeAsyncClient.start().block();
        logger.atInfo().log("RealtimeAsyncClient started");
    }

    @PreDestroy
    public void destroy() {
        logger.atInfo().log("Closing RealtimeAsyncClient");
        this.realtimeAsyncClient.stop().block();
        this.realtimeAsyncClient.close();
        disposables.dispose();
        logger.atInfo().log("RealtimeAsyncClient closed");
    }

    @Override
    public void afterConnectionEstablished(WebSocketSession session) throws Exception {
        logger.atInfo().log("Connection established: " + session.getId());
        realtimeAsyncClient.sendMessage(new SessionUpdateEvent(new RealtimeRequestSession()
            .setInputAudioFormat(RealtimeAudioFormat.PCM16)
            .setModalities(Arrays.asList(RealtimeRequestSessionModality.AUDIO, RealtimeRequestSessionModality.TEXT))
            .setInputAudioTranscription(new RealtimeAudioInputTranscriptionSettings()
                .setModel(RealtimeAudioInputTranscriptionModel.WHISPER_1))
            .setTurnDetection(new RealtimeServerVadTurnDetection())
            .setVoice(RealtimeVoice.ALLOY)
        )).block();

        ControlMessage controlMessage = new ControlMessage("connected")
                .setGreeting("You are now connected to the Spring Boot server");
        session.sendMessage(new TextMessage(objectMapper.writeValueAsString(controlMessage)));

        startEventLoop();
    }

    @Override
    protected void handleTextMessage(WebSocketSession session, TextMessage message) throws Exception {
//        super.handleTextMessage(session, message);
        System.out.println("Received message: " + message.getPayload());
    }

    @Override
    protected void handleBinaryMessage(WebSocketSession session, BinaryMessage message) {
//        super.handleBinaryMessage(session, message);
    }

    @Override
    public void handleTransportError(WebSocketSession session, Throwable exception) throws Exception {
        super.handleTransportError(session, exception);
    }

    @Override
    public void afterConnectionClosed(WebSocketSession session, CloseStatus status) throws Exception {
        super.afterConnectionClosed(session, status);
        logger.atInfo().log("Connection closed: " + session.getId());
        logger.atInfo().log("Close status: " + status);
    }

    private void startEventLoop() {
        disposables.add(
            realtimeAsyncClient.getServerEvents().onErrorResume((throwable ) -> {
                // Log the error and continue listening for events.
                logger.atError().setCause(throwable).log("Error sent from the Realtime server");
                return realtimeAsyncClient.getServerEvents();
            }).subscribe(event -> {
                // TODO
            })
        );
    }
}
