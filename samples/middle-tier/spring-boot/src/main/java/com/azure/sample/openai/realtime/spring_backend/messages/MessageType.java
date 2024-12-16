package com.azure.sample.openai.realtime.spring_backend.messages;

import com.fasterxml.jackson.annotation.JsonCreator;
import com.fasterxml.jackson.annotation.JsonValue;

public enum MessageType {
    CONTROL("control"),
    TEXT_DELTA("text_delta"),
//    TRANSCRIPTION("transcription"),
    USER_MESSAGE("user_message");


    private final String value;

    MessageType(String value) {
        this.value = value;
    }

    @JsonValue
    public String getValue() {
        return value;
    }

    @JsonCreator
    public static MessageType fromString(String value) {
        for (MessageType messageType : MessageType.values()) {
            if (messageType.value.equalsIgnoreCase(value)) {
                return messageType;
            }
        }
        throw new IllegalArgumentException("No constant with value " + value + " found");
    }
}
