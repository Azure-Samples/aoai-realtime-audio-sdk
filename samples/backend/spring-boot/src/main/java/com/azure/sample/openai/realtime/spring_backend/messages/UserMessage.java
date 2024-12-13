package com.azure.sample.openai.realtime.spring_backend.messages;

public class UserMessage {

    private final MessageType type = MessageType.USER_MESSAGE;

    private String text;

    public MessageType getType() {
        return type;
    }

    public String getText() {
        return text;
    }
}
