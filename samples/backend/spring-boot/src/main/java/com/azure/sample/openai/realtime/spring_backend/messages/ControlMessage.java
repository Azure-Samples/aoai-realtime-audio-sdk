package com.azure.sample.openai.realtime.spring_backend.messages;

public class ControlMessage extends ClientMessage{

    private final MessageType type = MessageType.CONTROL;
    private final String action;

    private String greeting;
    private String id;

    public ControlMessage(String action) {
        this.action = action;
    }

    public MessageType getType() {
        return type;
    }

    public String getGreeting() {
        return greeting;
    }

    public ControlMessage setGreeting(String greeting) {
        this.greeting = greeting;
        return this;
    }

    public String getId() {
        return id;
    }

    public ControlMessage setId(String id) {
        this.id = id;
        return this;
    }

    public String getAction() {
        return action;
    }
}
