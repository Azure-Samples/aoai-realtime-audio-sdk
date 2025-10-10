package com.azure.sample.openai.realtime.spring_backend.configurations;

import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.boot.context.properties.ConfigurationProperties;
import org.springframework.context.annotation.Configuration;

@Configuration
@ConfigurationProperties(prefix = "azureopenai.realtime")
@ConditionalOnProperty(
        name = "server.backend",
        havingValue = "azure"
)
class AzureOpenAIConfiguration {

    @Value("${azureopenai.realtime.endpoint}")
    private String azureOpenAIEndpoint;

    @Value("${azureopenai.realtime.apiKey}")
    private String azureOpenAIKey;

    @Value("${azureopenai.realtime.deployment}")
    private String azureOpenAIDeployment;

    public String getAzureOpenAIDeployment() {
        return azureOpenAIDeployment;
    }

    public String getAzureOpenAIKey() {
        return azureOpenAIKey;
    }

    public String getAzureOpenAIEndpoint() {
        return azureOpenAIEndpoint;
    }

}
