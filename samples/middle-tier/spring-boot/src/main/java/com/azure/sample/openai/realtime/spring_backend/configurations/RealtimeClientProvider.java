package com.azure.sample.openai.realtime.spring_backend.configurations;

import com.azure.ai.openai.realtime.RealtimeAsyncClient;
import com.azure.ai.openai.realtime.RealtimeClient;
import com.azure.ai.openai.realtime.RealtimeClientBuilder;
import com.azure.core.credential.KeyCredential;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.context.annotation.Bean;
import org.springframework.stereotype.Repository;

@Repository
public class RealtimeClientProvider {

    @Autowired(required = false)
    private OpenAIConfiguration openAIConfiguration;

    @Autowired(required = false)
    private AzureOpenAIConfiguration azureOpenAIConfiguration;

    @Bean
    public RealtimeClient buildClient() {
        RealtimeClientBuilder clientBuilder = getRealtimeClientBuilder();
        return clientBuilder.buildClient();
    }

    @Bean
    public RealtimeAsyncClient buildAsyncClient() {
        RealtimeClientBuilder clientBuilder = getRealtimeClientBuilder();
        return clientBuilder.buildAsyncClient();
    }

    private RealtimeClientBuilder getRealtimeClientBuilder() {
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
        return clientBuilder;
    }
}
