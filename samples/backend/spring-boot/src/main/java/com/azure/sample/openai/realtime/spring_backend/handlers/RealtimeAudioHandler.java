package com.azure.sample.openai.realtime.spring_backend.handlers;

import com.azure.ai.openai.realtime.RealtimeAsyncClient;
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

@Controller
public class RealtimeAudioHandler extends TextWebSocketHandler {

    private static final Logger logger = LoggerFactory.getLogger(RealtimeAudioHandler.class);
    private final RealtimeAsyncClient realtimeAsyncClient;

    public RealtimeAudioHandler(RealtimeAsyncClient realtimeAsyncClient) {
        this.realtimeAsyncClient = realtimeAsyncClient;
    }

    @Override
    public void afterConnectionEstablished(WebSocketSession session) throws Exception {
        logger.atInfo().log("Connection established: " + session.getId());
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
        logger.atInfo().log("RealtimeAsyncClient closed");
    }
}
