import { ServerMessageType } from "./models";

const isRealtimeEvent = (message: unknown): message is { type: string } =>
  typeof message === "object" && message !== null && "type" in message;

export const isServerMessageType = (
  message: unknown,
): message is ServerMessageType =>
  isRealtimeEvent(message) &&
  [
    "error",
    "session.created",
    "session.updated",
    "input_audio_buffer.committed",
    "input_audio_buffer.cleared",
    "input_audio_buffer.speech_started",
    "input_audio_buffer.speech_stopped",
    "conversation.item.created",
    "conversation.item.truncated",
    "conversation.item.deleted",
    "conversation.item.input_audio_transcription.completed",
    "conversation.item.input_audio_transcription.failed",
    "response.created",
    "response.done",
    "response.output_item.added",
    "response.output_item.done",
    "response.content_part.added",
    "response.content_part.done",
    "response.text.delta",
    "response.text.done",
    "response.audio_transcript.delta",
    "response.audio_transcript.done",
    "response.audio.delta",
    "response.audio.done",
    "response.function_call_arguments.delta",
    "response.function_call_arguments.done",
    "rate_limits.updated",
  ].includes(message.type);
