// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

export type AzureStandardVoice = {
  type: "azure-standard";
  name: string;
  temperature?: number;
}
export type AzureCustomVoice = {
  type: "azure-custom";
  name: string;
  endpoint_id: string;
  temperature?: number;
}
export type Voice =
  | "alloy"
  | "ash"
  | "ballad"
  | "coral"
  | "echo"
  | "sage"
  | "shimmer"
  | "verse"
  | AzureStandardVoice
  | AzureCustomVoice;
export type AudioFormat = "pcm16" | "g711-ulaw" | "g711-alaw";
export type Modality = "text" | "audio";

export interface NoTurnDetection {
  type: "none";
}

export interface ServerVAD {
  type: "server_vad";
  threshold?: number;
  prefix_padding_ms?: number;
  silence_duration_ms?: number;
  end_of_utterance_detection?: EOUDetection;
}

export interface AzureSemanticVAD {
  type: "azure_semantic_vad";
  threshold?: number;
  prefix_padding_ms?: number;
  silence_duration_ms?: number;
  remove_filler_words?: boolean;
  end_of_utterance_detection?: EOUDetection;
}

export type TurnDetection = ServerVAD | AzureSemanticVAD | null;

export interface AzureEOU {
  model: "semantic_detection_v1";
  threshold?: number;
}

export type EOUDetection = AzureEOU | null;

export interface FunctionToolChoice {
  type: "function";
  function: string;
}

export type ToolChoice = "auto" | "none" | "required" | FunctionToolChoice;

export type MessageRole = "system" | "assistant" | "user";

export interface InputAudioTranscription {
  model: "whisper-1" | "gpt-4o-transcribe" | "azure-fast-transcription";
  language?: string;
  prompt?: string;
}

export interface AvatarConfigVideoParams {
  bitrate?: number;
  codec: "h264";
  crop?: {
    bottom_right: [number, number];
    top_left: [number, number];
  };
  resolution?: {
    width: number;
    height: number;
  }
}

export interface AvatarConfig {
  ice_servers?: RTCIceServer[];
  character: string;
  style?: string;
  customized?: boolean;
  video?: AvatarConfigVideoParams;
}

export interface ClientMessageBase {
  event_id?: string;
}

export type ToolsDefinition = Record<string, any>[];

export interface ServerEchoCancellation {
  type: "server_echo_cancellation";
}

export interface AzureDeepNoiseSuppression {
  type: "azure_deep_noise_suppression";
}

export type InputAudioEchoCancellation = ServerEchoCancellation | null;

export type InputAudioNoiseReduction = AzureDeepNoiseSuppression | null;

export interface SessionUpdateParams {
  model?: string;
  modalities?: Modality[];
  voice?: Voice;
  instructions?: string;
  input_audio_format?: AudioFormat;
  output_audio_format?: AudioFormat;
  input_audio_transcription?: InputAudioTranscription | null;
  turn_detection?: TurnDetection;
  tools?: ToolsDefinition;
  tool_choice?: ToolChoice;
  temperature?: number;
  max_response_output_tokens?: number;
  avatar?: AvatarConfig;
  input_audio_noise_reduction?: InputAudioNoiseReduction;
  input_audio_echo_cancellation?: InputAudioEchoCancellation;
}

export interface SessionUpdateMessage extends ClientMessageBase {
  type: "session.update";
  session: SessionUpdateParams;
}

export interface InputAudioBufferAppendMessage extends ClientMessageBase {
  type: "input_audio_buffer.append";
  audio: string;
}

export interface InputAudioBufferCommitMessage extends ClientMessageBase {
  type: "input_audio_buffer.commit";
}

export interface InputAudioBufferClearMessage extends ClientMessageBase {
  type: "input_audio_buffer.clear";
}

export const MessageItemType = "message" as const;
export type MessageItemType = typeof MessageItemType;

export interface InputTextContentPart {
  type: "input_text";
  text: string;
}

export interface InputAudioContentPart {
  type: "input_audio";
  audio: string;
  transcript?: string;
}

export interface OutputTextContentPart {
  type: "text";
  text: string;
}

export type SystemContentPart = InputTextContentPart;
export type UserContentPart = InputTextContentPart | InputAudioContentPart;
export type AssistantContentPart = OutputTextContentPart;

export type ItemParamStatus = "completed" | "incomplete";

export interface SystemMessageItem {
  type: MessageItemType;
  role: "system";
  id?: string;
  content: SystemContentPart[];
  status?: ItemParamStatus;
}

export interface UserMessageItem {
  type: MessageItemType;
  role: "user";
  id?: string;
  content: UserContentPart[];
  status?: ItemParamStatus;
}

export interface AssistantMessageItem {
  type: MessageItemType;
  role: "assistant";
  id?: string;
  content: AssistantContentPart[];
  status?: ItemParamStatus;
}

export type MessageItem =
  | SystemMessageItem
  | UserMessageItem
  | AssistantMessageItem;

export interface FunctionCallItem {
  type: "function_call";
  id?: string;
  name: string;
  call_id: string;
  arguments: string;
  status?: ItemParamStatus;
}

export interface FunctionCallOutputItem {
  type: "function_call_output";
  id?: string;
  call_id: string;
  output: string;
  status?: ItemParamStatus;
}

export type Item = MessageItem | FunctionCallItem | FunctionCallOutputItem;

export interface ItemCreateMessage extends ClientMessageBase {
  type: "conversation.item.create";
  previous_item_id?: string;
  item: Item;
}

export interface ItemTruncateMessage extends ClientMessageBase {
  type: "conversation.item.truncate";
  item_id: string;
  content_index: number;
  audio_end_ms: number;
}

export interface ItemDeleteMessage extends ClientMessageBase {
  type: "conversation.item.delete";
  item_id: string;
}

export interface ResponseCreateParams {
  commit?: boolean;
  cancel_previous?: boolean;
  append_input_items?: Item[];
  input_items?: Item[];
  instructions?: string;
  modalities?: Modality[];
  voice?: Voice;
  temperature?: number;
  max_output_tokens?: number;
  tools?: ToolsDefinition;
  tool_choice?: ToolChoice;
  output_audio_format?: AudioFormat;
}

export interface ResponseCreateMessage extends ClientMessageBase {
  type: "response.create";
  response?: ResponseCreateParams;
}

export interface ResponseCancelMessage extends ClientMessageBase {
  type: "response.cancel";
}

export interface SessionAvatarConnectMessage extends ClientMessageBase {
  type: "session.avatar.connect";
  client_sdp: string;
}

export interface RealtimeError {
  message: string;
  type?: string;
  code?: string;
  param?: string;
  event_id?: string;
}

export interface ServerMessageBase {
  event_id: string;
}

export interface ErrorMessage extends ServerMessageBase {
  type: "error";
  error: RealtimeError;
}

export interface Session {
  id: string;
  model: string;
  modalities: Modality[];
  instructions: string;
  voice: Voice;
  input_audio_format: AudioFormat;
  output_audio_format: AudioFormat;
  input_audio_transcription?: InputAudioTranscription;
  turn_detection: TurnDetection;
  tools: ToolsDefinition;
  tool_choice: ToolChoice;
  temperature: number;
  max_response_output_tokens?: number;
  avatar?: AvatarConfig;
  input_audio_noise_reduction?: InputAudioNoiseReduction;
  input_audio_echo_cancellation?: InputAudioEchoCancellation;
}

export interface SessionCreatedMessage extends ServerMessageBase {
  type: "session.created";
  session: Session;
}

export interface SessionUpdatedMessage extends ServerMessageBase {
  type: "session.updated";
  session: Session;
}

export interface InputAudioBufferCommittedMessage extends ServerMessageBase {
  type: "input_audio_buffer.committed";
  previous_item_id?: string;
  item_id: string;
}

export interface InputAudioBufferClearedMessage extends ServerMessageBase {
  type: "input_audio_buffer.cleared";
}

export interface InputAudioBufferSpeechStartedMessage
  extends ServerMessageBase {
  type: "input_audio_buffer.speech_started";
  audio_start_ms: number;
  item_id: string;
}

export interface InputAudioBufferSpeechStoppedMessage
  extends ServerMessageBase {
  type: "input_audio_buffer.speech_stopped";
  audio_end_ms: number;
  item_id: string;
}

export type ResponseItemStatus = "in_progress" | "completed" | "incomplete";

export interface ResponseItemInputTextContentPart {
  type: "input_text";
  text: string;
}

export interface ResponseItemInputAudioContentPart {
  type: "input_audio";
  transcript?: string;
}

export interface ResponseItemTextContentPart {
  type: "text";
  text: string;
}

export interface ResponseItemAudioContentPart {
  type: "audio";
  transcript?: string;
}

export type ResponseItemContentPart =
  | ResponseItemInputTextContentPart
  | ResponseItemInputAudioContentPart
  | ResponseItemTextContentPart
  | ResponseItemAudioContentPart;

export interface ResponseItemBase {
  id?: string;
}

export interface ResponseMessageItem extends ResponseItemBase {
  type: MessageItemType;
  status: ResponseItemStatus;
  role: MessageRole;
  content: ResponseItemContentPart[];
}

export interface ResponseFunctionCallItem extends ResponseItemBase {
  type: "function_call";
  status: ResponseItemStatus;
  name: string;
  call_id: string;
  arguments: string;
}

export interface ResponseFunctionCallOutputItem extends ResponseItemBase {
  type: "function_call_output";
  call_id: string;
  output: string;
}

export type ResponseItem =
  | ResponseMessageItem
  | ResponseFunctionCallItem
  | ResponseFunctionCallOutputItem;

export interface ItemCreatedMessage extends ServerMessageBase {
  type: "conversation.item.created";
  previous_item_id?: string;
  item: ResponseItem;
}

export interface ItemTruncatedMessage extends ServerMessageBase {
  type: "conversation.item.truncated";
  item_id: string;
  content_index: number;
  audio_end_ms: number;
}

export interface ItemDeletedMessage extends ServerMessageBase {
  type: "conversation.item.deleted";
  item_id: string;
}

export interface ItemInputAudioTranscriptionCompletedMessage
  extends ServerMessageBase {
  type: "conversation.item.input_audio_transcription.completed";
  item_id: string;
  content_index: number;
  transcript: string;
}

export interface ItemInputAudioTranscriptionFailedMessage
  extends ServerMessageBase {
  type: "conversation.item.input_audio_transcription.failed";
  item_id: string;
  content_index: number;
  error: RealtimeError;
}

export type ResponseStatus =
  | "in_progress"
  | "completed"
  | "cancelled"
  | "incomplete"
  | "failed";

export interface ResponseCancelledDetails {
  type: "cancelled";
  reason: "turn_detected" | "client_cancelled";
}

export interface ResponseIncompleteDetails {
  type: "incomplete";
  reason: "max_output_tokens" | "content_filter";
}

export interface ResponseFailedDetails {
  type: "failed";
  error: RealtimeError;
}

export type ResponseStatusDetails =
  | ResponseCancelledDetails
  | ResponseIncompleteDetails
  | ResponseFailedDetails;

export interface InputTokenDetails {
  cached_tokens: number;
  text_tokens: number;
  audio_tokens: number;
}

export interface OutputTokenDetails {
  text_tokens: number;
  audio_tokens: number;
}

export interface Usage {
  total_tokens: number;
  input_tokens: number;
  output_tokens: number;
  input_token_details: InputTokenDetails;
  output_token_details: OutputTokenDetails;
}

export interface Response {
  id: string;
  status: ResponseStatus;
  status_details?: ResponseStatusDetails;
  output: ResponseItem[];
  usage?: Usage;
}

export interface ResponseCreatedMessage extends ServerMessageBase {
  type: "response.created";
  response: Response;
}

export interface ResponseDoneMessage extends ServerMessageBase {
  type: "response.done";
  response: Response;
}

export interface ResponseOutputItemAddedMessage extends ServerMessageBase {
  type: "response.output_item.added";
  response_id: string;
  output_index: number;
  item: ResponseItem;
}

export interface ResponseOutputItemDoneMessage extends ServerMessageBase {
  type: "response.output_item.done";
  response_id: string;
  output_index: number;
  item: ResponseItem;
}

export interface ResponseContentPartAddedMessage extends ServerMessageBase {
  type: "response.content_part.added";
  response_id: string;
  item_id: string;
  output_index: number;
  content_index: number;
  part: ResponseItemContentPart;
}

export interface ResponseContentPartDoneMessage extends ServerMessageBase {
  type: "response.content_part.done";
  response_id: string;
  item_id: string;
  output_index: number;
  content_index: number;
  part: ResponseItemContentPart;
}

export interface ResponseTextDeltaMessage extends ServerMessageBase {
  type: "response.text.delta";
  response_id: string;
  item_id: string;
  output_index: number;
  content_index: number;
  delta: string;
}

export interface ResponseTextDoneMessage extends ServerMessageBase {
  type: "response.text.done";
  response_id: string;
  item_id: string;
  output_index: number;
  content_index: number;
  text: string;
}

export interface ResponseAudioTranscriptDeltaMessage extends ServerMessageBase {
  type: "response.audio_transcript.delta";
  response_id: string;
  item_id: string;
  output_index: number;
  content_index: number;
  delta: string;
}

export interface ResponseAudioTranscriptDoneMessage extends ServerMessageBase {
  type: "response.audio_transcript.done";
  response_id: string;
  item_id: string;
  output_index: number;
  content_index: number;
  transcript: string;
}

export interface ResponseAudioDeltaMessage extends ServerMessageBase {
  type: "response.audio.delta";
  response_id: string;
  item_id: string;
  output_index: number;
  content_index: number;
  delta: string;
}

export interface ResponseAudioDoneMessage extends ServerMessageBase {
  type: "response.audio.done";
  response_id: string;
  item_id: string;
  output_index: number;
  content_index: number;
}

export interface ResponseFunctionCallArgumentsDeltaMessage
  extends ServerMessageBase {
  type: "response.function_call_arguments.delta";
  response_id: string;
  item_id: string;
  output_index: number;
  call_id: string;
  delta: string;
}

export interface ResponseFunctionCallArgumentsDoneMessage
  extends ServerMessageBase {
  type: "response.function_call_arguments.done";
  response_id: string;
  item_id: string;
  output_index: number;
  call_id: string;
  name: string;
  arguments: string;
}

export interface RateLimits {
  name: string;
  limit: number;
  remaining: number;
  reset_seconds: number;
}

export interface RateLimitsUpdatedMessage extends ServerMessageBase {
  type: "rate_limits.updated";
  rate_limits: RateLimits[];
}

export interface SessionAvatarConnectingMessage extends ServerMessageBase {
  type: "session.avatar.connecting";
  server_sdp: string;
}

export interface ResponseBlendShapeMessage extends ServerMessageBase {
  type: "response.animation.blendshapes";
  response_id: string;
  item_id: string;
  output_index: number;
  content_index: number;
  blendshapes: string;
}

export type UserMessageType =
  | SessionUpdateMessage
  | InputAudioBufferAppendMessage
  | InputAudioBufferCommitMessage
  | InputAudioBufferClearMessage
  | ItemCreateMessage
  | ItemTruncateMessage
  | ItemDeleteMessage
  | ResponseCreateMessage
  | ResponseCancelMessage
  | SessionAvatarConnectMessage;

export type ServerMessageType =
  | ErrorMessage
  | SessionCreatedMessage
  | SessionUpdatedMessage
  | InputAudioBufferCommittedMessage
  | InputAudioBufferClearedMessage
  | InputAudioBufferSpeechStartedMessage
  | InputAudioBufferSpeechStoppedMessage
  | ItemCreatedMessage
  | ItemTruncatedMessage
  | ItemDeletedMessage
  | ItemInputAudioTranscriptionCompletedMessage
  | ItemInputAudioTranscriptionFailedMessage
  | ResponseCreatedMessage
  | ResponseDoneMessage
  | ResponseOutputItemAddedMessage
  | ResponseOutputItemDoneMessage
  | ResponseContentPartAddedMessage
  | ResponseContentPartDoneMessage
  | ResponseTextDeltaMessage
  | ResponseTextDoneMessage
  | ResponseAudioTranscriptDeltaMessage
  | ResponseAudioTranscriptDoneMessage
  | ResponseAudioDeltaMessage
  | ResponseAudioDoneMessage
  | ResponseBlendShapeMessage
  | ResponseFunctionCallArgumentsDeltaMessage
  | ResponseFunctionCallArgumentsDoneMessage
  | RateLimitsUpdatedMessage
  | SessionAvatarConnectingMessage;
