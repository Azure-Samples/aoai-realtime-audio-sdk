package com.azure.sample.openai.realtime.spring_backend;

import com.azure.ai.openai.realtime.RealtimeClientBuilder;
import com.azure.core.credential.KeyCredential;
import com.azure.sample.openai.realtime.spring_backend.configurations.AzureOpenAIConfiguration;
import com.azure.sample.openai.realtime.spring_backend.configurations.OpenAIConfiguration;
import com.azure.sample.openai.realtime.spring_backend.handlers.RealtimeAudioHandler;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.context.annotation.Configuration;
import org.springframework.web.socket.config.annotation.EnableWebSocket;
import org.springframework.web.socket.config.annotation.WebSocketConfigurer;
import org.springframework.web.socket.config.annotation.WebSocketHandlerRegistry;

@Configuration
@EnableWebSocket
public class WebSocketConfiguration implements WebSocketConfigurer {

    @Autowired
    private AzureOpenAIConfiguration azureOpenAIConfiguration;

    @Autowired
    private OpenAIConfiguration openAIConfiguration;

    @Override
    public void registerWebSocketHandlers(WebSocketHandlerRegistry registry) {
        RealtimeClientBuilder clientBuilder = new RealtimeClientBuilder();
        if (openAIConfiguration != null) {
            clientBuilder.deploymentOrModelName(openAIConfiguration.getOpenAIModel())
                    .credential(new KeyCredential(openAIConfiguration.getOpenaiKey()));
        } else if (azureOpenAIConfiguration != null) {
            clientBuilder.endpoint(azureOpenAIConfiguration.getAzureOpenAIEndpoint())
                    .credential(new KeyCredential(azureOpenAIConfiguration.getAzureOpenAIKey()))
                    .deploymentOrModelName(azureOpenAIConfiguration.getAzureOpenAIDeployment());
        } else {
            throw new IllegalArgumentException("No Realtime service configuration found");
        }
        registry.addHandler(new RealtimeAudioHandler(clientBuilder.buildAsyncClient()), "/realtime").setAllowedOrigins("*");
    }
}
