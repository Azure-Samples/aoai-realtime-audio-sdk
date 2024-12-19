package com.azure.sample.openai.realtime.spring_backend.messages;

public class TextDeltaMessage {

    private final String id;

    private final MessageType type = MessageType.TEXT_DELTA;

    private final String delta;

    public TextDeltaMessage(String id, String text) {
        this.id = id;
        this.delta = text;
    }

    public String getId() {
        return id;
    }

    public MessageType getType() {
        return type;
    }

    public String getDelta() {
        return delta;
    }
}
