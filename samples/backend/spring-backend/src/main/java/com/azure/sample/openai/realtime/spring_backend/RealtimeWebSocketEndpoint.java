package com.azure.sample.openai.realtime.spring_backend;

import com.azure.ai.openai.realtime.RealtimeAsyncClient;
import com.azure.ai.openai.realtime.RealtimeClientBuilder;
import com.azure.core.credential.KeyCredential;
import com.azure.core.util.Configuration;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.core.env.Environment;
import org.springframework.web.socket.BinaryMessage;
import org.springframework.web.socket.CloseStatus;
import org.springframework.web.socket.TextMessage;
import org.springframework.web.socket.WebSocketSession;
import org.springframework.web.socket.handler.TextWebSocketHandler;

public class RealtimeWebSocketEndpoint extends TextWebSocketHandler {

    private static final Logger logger = LoggerFactory.getLogger(RealtimeWebSocketEndpoint.class);
    private RealtimeAsyncClient realtimeAsyncClient;

    // TODO jpalvarezl: Figure out how to correctly wire these
//    @Value("${openai.realtime.apiKey}")
//    private String openaiKey;
//
//    @Value("${azureopenai.realtime.endpoint}")
//    private String azureOpenAIEndpoint;
//
//    @Value("${azureopenai.realtime.apiKey}")
//    private String azureOpenAIKey;
//
//    @Value("${azureopenai.realtime.deployment}")
//    private String azureOpenAIDeployment;
//
//    @Value("${openai.realtime.model}")
//    private String openAIModel;
//
//    @Autowired
//    private Environment env;

    @Override
    public void afterConnectionEstablished(WebSocketSession session) throws Exception {
//        String openaiKey = env.getProperty("openai.realtime.apiKey");
//        String openAIModel = env.getProperty("openai.realtime.model");
        String openAIKey = Configuration.getGlobalConfiguration().get("OPENAI_KEY");
        String openAIModel = Configuration.getGlobalConfiguration().get("OPENAI_MODEL");

        logger.atInfo().log("Connection established: " + session.getId());
        this.realtimeAsyncClient = new RealtimeClientBuilder()
                .credential(new KeyCredential(openAIKey))
                .deploymentOrModelName(openAIModel)
                .buildAsyncClient();
        this.realtimeAsyncClient.start().block();
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
        logger.atInfo().log("Closing RealtimeAsyncClient");
        this.realtimeAsyncClient.stop().block();
        this.realtimeAsyncClient.close();
        logger.atInfo().log("RealtimeAsyncClient closed");
    }
}
