// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { describe, it, expect } from "vitest";
import { isServerMessageType } from "../src/model-utils";
import { ServerMessageType } from "../src/models";

describe("isServerMessageType", () => {
  it("should return true for valid server message types", () => {
    const validMessages: ServerMessageType[] = [
      {
        type: "error",
        event_id: "event1",
        error: {
          message: "An error occurred",
          type: "critical",
          code: "500",
          param: "param1",
          event_id: "event1",
        },
      },
      {
        type: "session.created",
        event_id: "event2",
        session: {
          id: "session1",
          model: "model1",
          modalities: ["text"],
          instructions: "instructions",
          voice: "alloy",
          input_audio_format: "pcm16",
          output_audio_format: "pcm16",
          turn_detection: { type: "none" },
          tools: [],
          tool_choice: "auto",
          temperature: 0.7,
        },
      },
      {
        type: "input_audio_buffer.committed",
        event_id: "event3",
        item_id: "item1",
      },
      {
        type: "input_audio_buffer.cleared",
        event_id: "event4",
      },
      {
        type: "input_audio_buffer.speech_started",
        event_id: "event5",
        audio_start_ms: 1000,
        item_id: "item2",
      },
      {
        type: "input_audio_buffer.speech_stopped",
        event_id: "event6",
        audio_end_ms: 2000,
        item_id: "item3",
      },
      {
        type: "conversation.item.created",
        event_id: "event7",
        item: {
          id: "item4",
          status: "completed",
          type: "message",
          role: "assistant",
          content: [{ type: "text", text: "Hello" }],
        },
      },
      {
        type: "conversation.item.truncated",
        event_id: "event8",
        item_id: "item5",
        content_index: 0,
        audio_end_ms: 3000,
      },
      {
        type: "conversation.item.deleted",
        event_id: "event9",
        item_id: "item6",
      },
      {
        type: "conversation.item.input_audio_transcription.completed",
        event_id: "event10",
        item_id: "item7",
        content_index: 0,
        transcript: "transcript",
      },
      {
        type: "conversation.item.input_audio_transcription.failed",
        event_id: "event11",
        item_id: "item8",
        content_index: 0,
        error: {
          message: "Transcription failed",
          type: "error",
          code: "400",
          param: "param2",
          event_id: "event11",
        },
      },
      {
        type: "response.created",
        event_id: "event12",
        response: {
          id: "response1",
          status: "in_progress",
          output: [],
        },
      },
      {
        type: "response.done",
        event_id: "event13",
        response: {
          id: "response2",
          status: "completed",
          output: [],
        },
      },
      {
        type: "response.output_item.added",
        event_id: "event14",
        response_id: "response3",
        output_index: 0,
        item: {
          id: "item9",
          status: "in_progress",
          type: "message",
          role: "user",
          content: [{ type: "input_text", text: "Hi" }],
        },
      },
      {
        type: "response.output_item.done",
        event_id: "event15",
        response_id: "response4",
        output_index: 1,
        item: {
          id: "item10",
          status: "completed",
          type: "message",
          role: "system",
          content: [{ type: "input_text", text: "Welcome" }],
        },
      },
      {
        type: "response.content_part.added",
        event_id: "event16",
        response_id: "response5",
        item_id: "item11",
        output_index: 2,
        content_index: 0,
        part: { type: "text", text: "Part 1" },
      },
      {
        type: "response.content_part.done",
        event_id: "event17",
        response_id: "response6",
        item_id: "item12",
        output_index: 3,
        content_index: 1,
        part: { type: "text", text: "Part 2" },
      },
      {
        type: "response.text.delta",
        event_id: "event18",
        response_id: "response7",
        item_id: "item13",
        output_index: 4,
        content_index: 2,
        delta: "Delta text",
      },
      {
        type: "response.text.done",
        event_id: "event19",
        response_id: "response8",
        item_id: "item14",
        output_index: 5,
        content_index: 3,
        text: "Done text",
      },
      {
        type: "response.audio_transcript.delta",
        event_id: "event20",
        response_id: "response9",
        item_id: "item15",
        output_index: 6,
        content_index: 4,
        delta: "Delta audio",
      },
      {
        type: "response.audio_transcript.done",
        event_id: "event21",
        response_id: "response10",
        item_id: "item16",
        output_index: 7,
        content_index: 5,
        transcript: "Done transcript",
      },
      {
        type: "response.audio.delta",
        event_id: "event22",
        response_id: "response11",
        item_id: "item17",
        output_index: 8,
        content_index: 6,
        delta: "Delta audio",
      },
      {
        type: "response.audio.done",
        event_id: "event23",
        response_id: "response12",
        item_id: "item18",
        output_index: 9,
        content_index: 7,
      },
      {
        type: "response.function_call_arguments.delta",
        event_id: "event24",
        response_id: "response13",
        item_id: "item19",
        output_index: 10,
        call_id: "call1",
        delta: "Delta arguments",
      },
      {
        type: "response.function_call_arguments.done",
        event_id: "event25",
        response_id: "response14",
        item_id: "item20",
        output_index: 11,
        call_id: "call2",
        name: "Function name",
        arguments: "Arguments",
      },
      {
        type: "rate_limits.updated",
        event_id: "event26",
        rate_limits: [
          {
            name: "limit1",
            limit: 100,
            remaining: 50,
            reset_seconds: 3600,
          },
        ],
      },
      {
        type: "connection.closed",
        event_id: "event32",
      },
    ];

    validMessages.forEach((message) => {
      expect(isServerMessageType(message)).toBe(true);
    });
  });

  it("should return false for invalid message types", () => {
    const invalidMessages = [
      { event: "unknown_event" },
      { event: "client_add_item" },
      { event: "remove_content" },
      { event: "session_ended" },
    ];

    invalidMessages.forEach((message) => {
      expect(isServerMessageType(message)).toBe(false);
    });
  });

  it("should return false for non-object types", () => {
    const nonObjectMessages = [null, undefined, 42, "string", true, []];

    nonObjectMessages.forEach((message) => {
      expect(isServerMessageType(message)).toBe(false);
    });
  });

  it("should return false for objects without an event property", () => {
    const invalidMessages = [{}, { foo: "bar" }, { event: 123 }];

    invalidMessages.forEach((message) => {
      expect(isServerMessageType(message)).toBe(false);
    });
  });
});
