// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { isServerMessageType } from "./model-utils";
import {
  InputAudioBufferSpeechStoppedMessage,
  Item,
  ItemInputAudioTranscriptionCompletedMessage,
  ItemInputAudioTranscriptionFailedMessage,
  MessageRole,
  RealtimeError,
  Response,
  ResponseAudioDeltaMessage,
  ResponseAudioDoneMessage,
  ResponseAudioTranscriptDeltaMessage,
  ResponseAudioTranscriptDoneMessage,
  ResponseContentPartAddedMessage,
  ResponseContentPartDoneMessage,
  ResponseFunctionCallItem,
  ResponseItem,
  ResponseItemAudioContentPart,
  ResponseItemStatus,
  ResponseItemTextContentPart,
  ResponseMessageItem,
  ResponseStatus,
  ResponseStatusDetails,
  ServerMessageType,
  Session,
  SessionUpdateParams,
  Usage,
  UserMessageType,
} from "./models";
import {
  validationError,
  validationSuccess,
  WebSocketClient,
} from "./util/websocket-client";
import { MessageEvent } from "./util/websocket";
import {
  isCredential,
  isKeyCredential,
  KeyCredential,
  TokenCredential,
} from "./util/auth";
import {
  ConnectionSettings,
  isRTAzureOpenAIOptions,
  isRTOpenAIOptions,
  RTAzureOpenAIOptions,
  RTOpenAIOptions,
} from "./util/interfaces";
import {
  azureOpenAISettings,
  openAISettings,
} from "./util/connection-settings";
import { MessageQueueWithError, SharedEndQueue } from "./util/message_queue";
import { generateId } from "./util/crypto";

export class LowLevelRTClient {
  public requestId: string | undefined;
  private client: WebSocketClient<UserMessageType, ServerMessageType>;

  private getWebsocket(
    settings: ConnectionSettings,
  ): WebSocketClient<UserMessageType, ServerMessageType> {
    const handler = {
      validate: (event: MessageEvent) => {
        if (typeof event.data !== "string") {
          return validationError<ServerMessageType>(
            new Error("Invalid message type"),
          );
        }
        try {
          const data = JSON.parse(event.data as string);
          if (isServerMessageType(data)) {
            return validationSuccess(data);
          }
          return validationError<ServerMessageType>(
            new Error("Invalid message type"),
          );
        } catch (error) {
          return validationError<ServerMessageType>(
            new Error("Invalid JSON message"),
          );
        }
      },
      serialize: (message: UserMessageType) => JSON.stringify(message),
    };

    return new WebSocketClient<UserMessageType, ServerMessageType>(
      settings,
      handler,
    );
  }

  constructor(credential: KeyCredential, options: RTOpenAIOptions);
  constructor(
    uri: URL,
    credential: KeyCredential | TokenCredential,
    options: RTAzureOpenAIOptions,
  );
  constructor(
    uriOrCredential: URL | KeyCredential,
    credentialOrOptions: KeyCredential | TokenCredential | RTOpenAIOptions,
    options?: RTAzureOpenAIOptions,
  ) {
    const settings = (() => {
      if (
        isKeyCredential(uriOrCredential) &&
        isRTOpenAIOptions(credentialOrOptions)
      ) {
        return openAISettings(uriOrCredential, credentialOrOptions);
      } else if (
        isCredential(credentialOrOptions) &&
        isRTAzureOpenAIOptions(options)
      ) {
        return azureOpenAISettings(
          uriOrCredential as URL,
          credentialOrOptions,
          options,
        );
      } else {
        throw new Error(
          "Invalid combination of arguments to initialize the Realtime client",
        );
      }
    })();
    this.requestId = settings.requestId;
    this.client = this.getWebsocket(settings);
  }

  async *messages(): AsyncIterable<ServerMessageType> {
    for await (const message of this.client) {
      yield message;
    }
  }

  async send(message: UserMessageType): Promise<void> {
    await this.client.send(message);
  }

  async close(): Promise<void> {
    await this.client.close();
  }
}

export class RTError extends Error {
  constructor(private errorDetails: RealtimeError) {
    super(errorDetails.message);
    Object.setPrototypeOf(this, RTError.prototype);
  }

  get code(): string | undefined {
    return this.errorDetails.code;
  }

  get param(): string | undefined {
    return this.errorDetails.param;
  }

  get eventId(): string | undefined {
    return this.errorDetails.event_id;
  }
}

type Optional<T> = T | undefined;

class RTInputAudioItem {
  public type: "input_audio" = "input_audio";
  public audioEndMillis: Optional<number> = undefined;
  public transcription: Optional<string> = undefined;

  private waitPromise: Promise<void> | null = null;

  private constructor(
    public readonly id: string,
    public audioStartMillis: Optional<number>,
    private hasTranscription: boolean,
    private queue: MessageQueueWithError<ServerMessageType>,
  ) {}

  static create(
    id: string,
    audioStartMillis: Optional<number>,
    hasTranscription: boolean,
    queue: MessageQueueWithError<ServerMessageType>,
  ): RTInputAudioItem {
    return new RTInputAudioItem(id, audioStartMillis, hasTranscription, queue);
  }

  private async wait(): Promise<void> {
    const itemIdValidMessage = (
      message: ServerMessageType,
    ): message is
      | InputAudioBufferSpeechStoppedMessage
      | ItemInputAudioTranscriptionCompletedMessage
      | ItemInputAudioTranscriptionFailedMessage =>
      [
        "input_audio_buffer.speech_stopped",
        "conversation.item.input_audio_transcription.completed",
        "conversation.item.input_audio_transcription.failed",
      ].includes(message.type);

    while (true) {
      const message = await this.queue.receive(
        (m) =>
          (itemIdValidMessage(m) && m.item_id == this.id) ||
          (m.type === "conversation.item.created" && m.item.id == this.id),
      );
      if (message === null) {
        return;
      } else if (message.type === "error") {
        throw new RTError(message.error);
      } else if (message.type === "input_audio_buffer.speech_stopped") {
        this.audioEndMillis = message.audio_end_ms;
        if (!this.hasTranscription) {
          return;
        }
      } else if (
        message.type === "conversation.item.created" &&
        !this.hasTranscription
      ) {
        return;
      } else if (
        message.type === "conversation.item.input_audio_transcription.completed"
      ) {
        this.transcription = message.transcript;
        return;
      } else if (
        message.type === "conversation.item.input_audio_transcription.failed"
      ) {
        throw new RTError(message.error);
      }
    }
  }

  waitForCompletion(): Promise<void> {
    if (!this.waitPromise) {
      this.waitPromise = this.wait();
    }
    return this.waitPromise;
  }
}

export type { RTInputAudioItem };

/* TODO: Move to PAL so we use Buffer.from in Node */
function decodeBase64(base64: string): Uint8Array {
  const binaryString = atob(base64);
  const length = binaryString.length;
  const uint8Array = new Uint8Array(length);

  for (let i = 0; i < length; i++) {
    uint8Array[i] = binaryString.charCodeAt(i);
  }

  return uint8Array;
}

class RTAudioContent {
  public type: "audio" = "audio";

  public itemId: string;
  public contentIndex: number;
  private part: ResponseItemAudioContentPart;
  private contentQueue: SharedEndQueue<ServerMessageType | null>;

  private constructor(
    message: ResponseContentPartAddedMessage,
    private queue: MessageQueueWithError<ServerMessageType>,
  ) {
    this.itemId = message.item_id;
    this.contentIndex = message.content_index;
    if (message.part.type !== "audio") {
      throw new Error("Unexpected part type");
    }
    this.part = message.part;
    this.contentQueue = new SharedEndQueue(
      () => this.receiveContent(),
      (m) => m !== null && m.type === "error",
      (m) => m !== null && m.type === "response.content_part.done",
    );
  }

  static create(
    message: ResponseContentPartAddedMessage,
    queue: MessageQueueWithError<ServerMessageType>,
  ): RTAudioContent {
    return new RTAudioContent(message, queue);
  }

  get transcript(): Optional<string> {
    return this.part.transcript;
  }

  private receiveContent(): Promise<ServerMessageType | null> {
    function isValidMessage(
      m: ServerMessageType,
    ): m is
      | ResponseAudioDeltaMessage
      | ResponseAudioDoneMessage
      | ResponseAudioTranscriptDeltaMessage
      | ResponseAudioTranscriptDoneMessage
      | ResponseContentPartDoneMessage {
      return [
        "response.audio.delta",
        "response.audio.done",
        "response.audio_transcript.delta",
        "response.audio_transcript.done",
        "response.content_part.done",
      ].includes(m.type);
    }
    return this.queue.receive(
      (m) =>
        isValidMessage(m) &&
        m.item_id === this.itemId &&
        m.content_index === this.contentIndex,
    );
  }

  async *audioChunks(): AsyncIterable<Uint8Array> {
    while (true) {
      const message = await this.contentQueue.receive(
        (m) =>
          m !== null &&
          ["response.audio.delta", "response.audio.done"].includes(m.type),
      );
      if (message === null) {
        break;
      } else if (message.type === "error") {
        throw new RTError(message.error);
      } else if (message.type === "response.content_part.done") {
        if (message.part.type !== "audio") {
          throw new Error("Unexpected part type");
        }
        this.part = message.part;
        break;
      } else if (message.type === "response.audio.delta") {
        const buffer = decodeBase64(message.delta);
        yield buffer;
      } else if (message.type === "response.audio.done") {
        // We are skipping this as it's information is already provided by 'response.content_part.done'
        // and that is a better signal to end the iteration
        continue;
      }
    }
  }

  async *transcriptChunks(): AsyncIterable<string> {
    while (true) {
      const message = await this.contentQueue.receive(
        (m) =>
          m !== null &&
          [
            "response.audio_transcript.delta",
            "response.audio_transcript.done",
          ].includes(m.type),
      );
      if (message === null) {
        break;
      } else if (message.type === "error") {
        throw new RTError(message.error);
      } else if (message.type === "response.content_part.done") {
        if (message.part.type !== "audio") {
          throw new Error("Unexpected part type");
        }
        this.part = message.part;
        break;
      } else if (message.type === "response.audio_transcript.delta") {
        yield message.delta;
      } else if (message.type === "response.audio_transcript.done") {
        // We are skipping this as it's information is already provided by 'response.content_part.done'
        // and that is a better signal to end the iteration
        continue;
      }
    }
  }
}

export type { RTAudioContent };

class RTTextContent {
  public type: "text" = "text";

  public itemId: string;
  public contentIndex: number;
  private part: ResponseItemTextContentPart;

  private constructor(
    message: ResponseContentPartAddedMessage,
    private queue: MessageQueueWithError<ServerMessageType>,
  ) {
    this.itemId = message.item_id;
    this.contentIndex = message.content_index;
    if (message.part.type !== "text") {
      throw new Error("Unexpected part type");
    }
    this.part = message.part;
  }

  static create(
    message: ResponseContentPartAddedMessage,
    queue: MessageQueueWithError<ServerMessageType>,
  ) {
    return new RTTextContent(message, queue);
  }

  get text(): string {
    return this.part.text;
  }

  async *textChunks(): AsyncIterable<string> {
    while (true) {
      const message = await this.queue.receive(
        (m) =>
          (m.type === "response.content_part.done" ||
            m.type === "response.text.delta" ||
            m.type === "response.text.done") &&
          m.item_id === this.itemId &&
          m.content_index === this.contentIndex,
      );
      if (message === null) {
        break;
      } else if (message.type === "error") {
        throw new RTError(message.error);
      } else if (message.type === "response.content_part.done") {
        if (message.part.type !== "text") {
          throw new Error("Unexpected part type");
        }
        this.part = message.part;
        break;
      } else if (message.type === "response.text.delta") {
        yield message.delta;
      } else if (message.type === "response.text.done") {
        // We are skipping this as it's information is already provided by 'response.content_part.done'
        // and that is a better signal to end the iteration
        continue;
      }
    }
  }
}

export type { RTTextContent };

export type RTMessageContent = RTAudioContent | RTTextContent;

class RTMessageItem implements AsyncIterable<RTMessageContent> {
  public type: "message" = "message";

  private constructor(
    public responseId: string,
    private item: ResponseMessageItem,
    public previousItemId: Optional<string>,
    private queue: MessageQueueWithError<ServerMessageType>,
  ) {}

  static create(
    responseId: string,
    item: ResponseMessageItem,
    previousItemId: Optional<string>,
    queue: MessageQueueWithError<ServerMessageType>,
  ): RTMessageItem {
    return new RTMessageItem(responseId, item, previousItemId, queue);
  }

  get id(): string {
    return this.item.id!;
  }

  get role(): MessageRole {
    return this.item.role;
  }

  get status(): ResponseItemStatus {
    return this.item.status;
  }

  async *[Symbol.asyncIterator]() {
    while (true) {
      const message = await this.queue.receive(
        (m) =>
          (m.type === "response.content_part.added" && m.item_id === this.id) ||
          (m.type === "response.output_item.done" && m.item.id === this.id),
      );
      if (message === null) {
        break;
      } else if (message.type === "error") {
        throw new RTError(message.error);
      } else if (message.type === "response.output_item.done") {
        if (message.item.type === "message") {
          this.item = message.item;
        } else {
          throw new Error("Unexpected item type");
        }
        break;
      } else if (message.type === "response.content_part.added") {
        if (message.part.type === "audio") {
          yield RTAudioContent.create(message, this.queue);
        } else if (message.part.type === "text") {
          yield RTTextContent.create(message, this.queue);
        } else {
          throw new Error(`Unexpected part type: ${message.part.type}`);
        }
      } else {
        throw new Error(`Unexpected message type: ${message.type}`);
      }
    }
  }
}

export type { RTMessageItem };

class RTFunctionCallItem implements AsyncIterable<string> {
  public type: "function_call" = "function_call";
  private awaited: boolean = false;
  private iterated: boolean = false;

  private constructor(
    public responseId: string,
    private item: ResponseFunctionCallItem,
    public previousItemId: Optional<string>,
    private queue: MessageQueueWithError<ServerMessageType>,
  ) {}

  static create(
    responseId: string,
    item: ResponseFunctionCallItem,
    previousItemId: Optional<string>,
    queue: MessageQueueWithError<ServerMessageType>,
  ): RTFunctionCallItem {
    return new RTFunctionCallItem(responseId, item, previousItemId, queue);
  }

  get id(): string {
    return this.item.id!;
  }

  get functionName(): string {
    return this.item.name;
  }

  get callId(): string {
    return this.item.call_id;
  }

  get arguments(): string {
    return this.item.arguments;
  }

  private async *inner(): AsyncIterable<string> {
    while (true) {
      const message = await this.queue.receive(
        (m) =>
          ((m.type == "response.function_call_arguments.delta" ||
            m.type == "response.function_call_arguments.done") &&
            m.item_id === this.id) ||
          (m.type === "response.output_item.done" && m.item.id === this.id),
      );
      if (message === null) {
        break;
      } else if (message.type === "error") {
        throw new RTError(message.error);
      } else if (message.type === "response.output_item.done") {
        if (message.item.type === "function_call") {
          this.item = message.item;
          break;
        } else {
          throw new Error("Unexpected item type");
        }
      } else if (message.type === "response.function_call_arguments.delta") {
        yield message.delta;
      } else if (message.type === "response.function_call_arguments.done") {
        continue;
      } else {
        throw new Error(`Unexpected message type: ${message.type}`);
      }
    }
  }

  async *[Symbol.asyncIterator](): AsyncIterator<string> {
    if (this.awaited) {
      throw new Error("Cannot iterate after awaiting.");
    }
    this.iterated = true;
    return this.inner();
  }

  async waitForCompletion(): Promise<void> {
    if (this.iterated) {
      throw new Error("Cannot await after iterating.");
    }
    this.awaited = true;
    for await (const _ of this.inner()) {
      // consume the remaining items
    }
  }
}

export type { RTFunctionCallItem };

type RTOutputItem = RTMessageItem | RTFunctionCallItem;

export function isMessageItem(item: RTOutputItem): item is RTMessageItem {
  return item.type === "message";
}

export function isFunctionCallItem(
  item: RTOutputItem,
): item is RTFunctionCallItem {
  return item.type === "function_call";
}

class RTResponse implements AsyncIterable<RTOutputItem> {
  public type: "response" = "response";
  private done: boolean = false;

  private constructor(
    private response: Response,
    private queue: MessageQueueWithError<ServerMessageType>,
    private client: LowLevelRTClient,
  ) {}

  static create(
    response: Response,
    queue: MessageQueueWithError<ServerMessageType>,
    client: LowLevelRTClient,
  ): RTResponse {
    return new RTResponse(response, queue, client);
  }

  get id(): string {
    return this.response.id;
  }

  get status(): ResponseStatus {
    return this.response.status;
  }

  get statusDetails(): Optional<ResponseStatusDetails> {
    return this.response.status_details;
  }

  get output(): ResponseItem[] {
    return this.response.output;
  }

  get usage(): Optional<Usage> {
    return this.response.usage;
  }

  async cancel(): Promise<void> {
    await this.client.send({
      type: "response.cancel",
    });
    for await (const _ of this) {
    }
    // consume the remaining items
  }

  [Symbol.asyncIterator](): AsyncIterator<RTOutputItem> {
    return {
      next: async (): Promise<IteratorResult<RTOutputItem>> => {
        if (this.done) {
          return { value: undefined, done: true };
        }
        const message = await this.queue.receive(
          (m) =>
            (m.type === "response.done" && m.response.id === this.id) ||
            (m.type === "response.output_item.added" &&
              m.response_id === this.id),
        );
        if (message === null) {
          return { value: undefined, done: true };
        } else if (message.type === "error") {
          throw new RTError(message.error);
        } else if (message.type === "response.done") {
          this.done = true;
          this.response = message.response;
          return { value: undefined, done: true };
        } else if (message.type === "response.output_item.added") {
          const created_message = await this.queue.receive(
            (m) =>
              m.type === "conversation.item.created" &&
              m.item.id === message.item.id,
          );
          if (created_message === null) {
            return { value: undefined, done: true };
          } else if (created_message.type === "error") {
            throw new RTError(created_message.error);
          } else if (created_message.type === "conversation.item.created") {
            if (created_message.item.type === "message") {
              const messageItem = RTMessageItem.create(
                this.id,
                created_message.item,
                created_message.previous_item_id,
                this.queue,
              );
              return { value: messageItem, done: false };
            } else if (created_message.item.type === "function_call") {
              const functionCallItem = RTFunctionCallItem.create(
                this.id,
                created_message.item,
                created_message.previous_item_id,
                this.queue,
              );
              return { value: functionCallItem, done: false };
            } else {
              throw new Error(
                `Unexpected item type (${created_message.item.type}.`,
              );
            }
          } else {
            throw new Error(`Unexpected message type: ${created_message.type}`);
          }
        } else {
          throw new Error(`Unexpected message type: ${message.type}`);
        }
      },
    };
  }
}

export type { RTResponse };

export class RTClient {
  private client: LowLevelRTClient;
  private messageQueue: MessageQueueWithError<ServerMessageType>;
  private messagesIterable: AsyncIterator<ServerMessageType>;
  public session: Session | undefined;

  private initPromise: Promise<void> | undefined;
  private iterating: boolean = false;

  constructor(credential: KeyCredential, options: RTOpenAIOptions);
  constructor(
    uri: URL,
    credential: KeyCredential | TokenCredential,
    options: RTAzureOpenAIOptions,
  );
  constructor(
    uriOrCredential: URL | KeyCredential,
    credentialOrOptions: KeyCredential | TokenCredential | RTOpenAIOptions,
    options?: RTAzureOpenAIOptions,
  ) {
    this.client = (() => {
      if (isKeyCredential(uriOrCredential)) {
        return new LowLevelRTClient(
          uriOrCredential,
          credentialOrOptions as RTOpenAIOptions,
        );
      } else {
        return new LowLevelRTClient(
          uriOrCredential as URL,
          credentialOrOptions as KeyCredential | TokenCredential,
          options as RTAzureOpenAIOptions,
        );
      }
    })();
    this.messagesIterable = this.client.messages()[Symbol.asyncIterator]();
    this.messageQueue = new MessageQueueWithError<ServerMessageType>(
      () => this.receiveMessages(),
      (m) => m.type === "error",
    );
  }

  private async receiveMessages(): Promise<ServerMessageType | null> {
    const result = await this.messagesIterable.next();
    return result.done ? null : result.value;
  }

  get requestId(): string | undefined {
    return this.client.requestId;
  }

  init(): Promise<void> {
    if (this.initPromise !== undefined) {
      return this.initPromise;
    }
    this.initPromise = (async () => {
      if (this.session !== undefined) {
        return;
      }
      // const message = await this.messageQueue.receive(
      //   (m) => m.type === "session.created",
      // );
      // if (message === null) {
      //   throw new Error("Failed to initialize session");
      // }
      // if (message.type === "error") {
      //   throw new RTError(message.error);
      // }
      // if (message.type !== "session.created") {
      //   throw new Error("Unexpected message type");
      // }
      // this.session = message.session;
    })();
    return this.initPromise;
  }

  async configure(params: SessionUpdateParams): Promise<Session> {
    await this.init();
    await this.client.send({
      type: "session.update",
      session: params,
    });
    const message = await this.messageQueue.receive(
      (m) => m.type === "session.updated",
    );
    if (message === null) {
      throw new Error("Failed to update session");
    }
    if (message.type === "error") {
      throw new RTError(message.error);
    }
    if (message.type !== "session.updated") {
      throw new Error("Unexpected message type");
    }
    this.session = message.session;
    return this.session;
  }

  async sendAudio(audio: Uint8Array): Promise<void> {
    await this.init();
    const base64 = btoa(String.fromCharCode(...audio));
    await this.client.send({
      type: "input_audio_buffer.append",
      audio: base64,
    });
  }

  async commitAudio(): Promise<RTInputAudioItem> {
    await this.init();
    await this.client.send({ type: "input_audio_buffer.commit" });
    const message = await this.messageQueue.receive(
      (m) => m.type === "input_audio_buffer.committed",
    );
    if (message === null) {
      throw new Error("Failed to commit audio");
    } else if (message.type === "error") {
      throw new RTError(message.error);
    } else if (message.type === "input_audio_buffer.committed") {
      return RTInputAudioItem.create(
        message.item_id,
        undefined,
        this.session?.input_audio_transcription !== undefined &&
          this.session?.input_audio_transcription !== null,
        this.messageQueue,
      );
    } else {
      throw new Error("Unexpected message type");
    }
  }

  async clearAudio(): Promise<void> {
    await this.init();
    await this.client.send({ type: "input_audio_buffer.clear" });
    const message = await this.messageQueue.receive(
      (m) => m.type === "input_audio_buffer.cleared",
    );
    if (message === null) {
      throw new Error("Failed to clear audio");
    } else if (message.type === "error") {
      throw new RTError(message.error);
    } else if (message.type !== "input_audio_buffer.cleared") {
      throw new Error("Unexpected message type");
    }
  }

  async sendItem(item: Item, previousItemId?: string): Promise<ResponseItem> {
    await this.init();
    item.id = item.id || generateId("item", 32);
    await this.client.send({
      type: "conversation.item.create",
      previous_item_id: previousItemId,
      item,
    });
    const message = await this.messageQueue.receive(
      (m) => m.type === "conversation.item.created" && m.item.id === item.id,
    );
    if (message === null) {
      throw new Error("Failed to create item");
    } else if (message.type === "error") {
      throw new RTError(message.error);
    } else if (message.type === "conversation.item.created") {
      return message.item;
    } else {
      throw new Error("Unexpected message type");
    }
  }

  async removeItem(itemId: string): Promise<void> {
    await this.init();
    await this.client.send({
      type: "conversation.item.delete",
      item_id: itemId,
    });
    const message = await this.messageQueue.receive(
      (m) => m.type === "conversation.item.deleted" && m.item_id === itemId,
    );
    if (message === null) {
      throw new Error("Failed to delete item");
    } else if (message.type === "error") {
      throw new RTError(message.error);
    } else if (message.type === "conversation.item.deleted") {
      return;
    } else {
      throw new Error("Unexpected message type");
    }
  }

  async generateResponse(): Promise<RTResponse | undefined> {
    await this.init();
    await this.client.send({ type: "response.create" });
    if (!this.iterating) {
      const message = await this.messageQueue.receive(
        (m) => m.type === "response.created",
      );
      if (message === null) {
        throw new Error("Failed to create response");
      } else if (message.type === "error") {
        throw new RTError(message.error);
      } else if (message.type === "response.created") {
        return RTResponse.create(
          message.response,
          this.messageQueue,
          this.client,
        );
      }
      throw new Error("Unexpected message type");
    }
    return undefined;
  }

  async *events(): AsyncIterable<RTInputAudioItem | RTResponse> {
    // TODO: Add the updated quota message as a control type of event.
    try {
      this.iterating = true;
      while (true) {
        const message = await this.messageQueue.receive(
          (m) =>
            m.type === "input_audio_buffer.speech_started" ||
            m.type === "response.created",
        );
        if (message === null) {
          break;
        } else if (message.type === "error") {
          throw new RTError(message.error);
        } else if (message.type === "input_audio_buffer.speech_started") {
          yield RTInputAudioItem.create(
            message.item_id,
            message.audio_start_ms,
            this.session?.input_audio_transcription !== undefined &&
              this.session?.input_audio_transcription !== null,
            this.messageQueue,
          );
        } else if (message.type === "response.created") {
          yield RTResponse.create(
            message.response,
            this.messageQueue,
            this.client,
          );
        } else {
          throw new Error("Unexpected message type");
        }
      }
    } finally {
      this.iterating = false;
    }
  }

  async close(): Promise<void> {
    await this.client.close();
  }
}
