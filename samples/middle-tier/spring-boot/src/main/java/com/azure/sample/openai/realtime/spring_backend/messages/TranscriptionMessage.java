package com.azure.sample.openai.realtime.spring_backend.messages;

public class TranscriptionMessage {
    private final String id;

    private final MessageType type = MessageType.TRANSCRIPTION;

    private String text;

    public TranscriptionMessage(String id) {
        this.id = id;
    }

    public String getId() {
        return id;
    }

    public MessageType getType() {
        return type;
    }

    public String getText() {
        return text;
    }

    public TranscriptionMessage setText(String text) {
        this.text = text;
        return this;
    }
}
