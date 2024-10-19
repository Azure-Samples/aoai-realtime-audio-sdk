// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { isServerMessageType } from "./model-utils";
import {
  InputAudioBufferSpeechStoppedMessage,
  Item,
  ItemInputAudioTranscriptionCompletedMessage,
  ItemInputAudioTranscriptionFailedMessage,
  RealtimeError,
  ResponseItem,
  ServerMessageType,
  Session,
  SessionUpdateParams,
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
import { MessageQueueWithError } from "./util/message_queue";
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
  public audioEndMillis: Optional<number> = undefined;
  public transcription: Optional<string> = undefined;

  private waitPromise: Promise<void> | null = null;

  private constructor(
    private id: string,
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

export class RTClient {
  private client: LowLevelRTClient;
  private messageQueue: MessageQueueWithError<ServerMessageType>;
  private messagesIterable: AsyncIterator<ServerMessageType>;
  public session: Session | undefined;

  private initPromise: Promise<void> | undefined;

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
      const message = await this.messageQueue.receive(
        (m) => m.type === "session.created",
      );
      if (message === null) {
        throw new Error("Failed to initialize session");
      }
      if (message.type === "error") {
        throw new RTError(message.error);
      }
      if (message.type !== "session.created") {
        throw new Error("Unexpected message type");
      }
      this.session = message.session;
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

  async generateResponse() {
    throw new Error("Not implemented");
  }

  async *events() {
    throw new Error("Not implemented");
  }

  async close(): Promise<void> {
    await this.client.close();
  }
}
