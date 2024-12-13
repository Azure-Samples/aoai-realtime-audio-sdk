package com.azure.sample.openai.realtime.spring_backend.configurations;

import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.context.properties.ConfigurationProperties;
import org.springframework.context.annotation.Configuration;

@Configuration
@ConfigurationProperties(prefix = "server")
public class ServerConfiguration {
    @Value("${server.port}")
    private int serverPort;

    @Value("${server.host}")
    private String serverHost;

    public int getServerPort() {
        return serverPort;
    }

    public String getServerHost() {
        return serverHost;
    }
}
