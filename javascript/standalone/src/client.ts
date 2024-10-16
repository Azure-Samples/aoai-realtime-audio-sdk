// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { isServerMessageType } from "./model-utils";
import { ServerMessageType, UserMessageType } from "./models";
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
    uriOrCredential: URL | KeyCredential | TokenCredential,
    credentialOrOptions?: KeyCredential | TokenCredential | RTOpenAIOptions,
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
/*
export interface RTMessageContentChunk {
  type: MessageContentType;
  data: string;
  index: number;
}

class RTMessage implements AsyncIterable<RTMessageContentChunk> {
  private constructor(
    readonly id: string,
    readonly previousId: string | undefined,
    readonly conversationLabel: string,
    readonly content: MessageContent[],
    private readonly receive: () => Promise<ServerMessageType>,
  ) {}

  async *[Symbol.asyncIterator](): AsyncIterator<RTMessageContentChunk> {
    while (true) {
      const serverMessage = await this.receive();
      if (serverMessage === null) {
        break;
      }
      if (serverMessage.event === "message_added") {
        break;
      }
      if (
        serverMessage.event === "add_content" &&
        serverMessage.message_id === this.id
      ) {
        // const content = this.content[serverMessage.index];

        // switch (serverMessage.type) {
        //   case "text":
        //     if (content.type !== "text") {
        //       throw new Error("Unexpected content type");
        //     }
        //     content.text += serverMessage.data;
        //     break;
        //   case "audio":
        //     if (content.type !== "audio") {
        //       throw new Error("Unexpected content type");
        //     }
        //     content.audio += serverMessage.data;
        //     break;
        //   case "tool_call":
        //     if (content.type !== "tool_call") {
        //       throw new Error("Unexpected content type");
        //     }
        //     content.arguments += serverMessage.data;
        //     break;
        //   default:
        //     break;
        // }
        yield {
          type: serverMessage.type,
          data: serverMessage.data,
          index: serverMessage.index,
        };
      }
    }
  }

  static _create(
    id: string,
    previousId: string | undefined,
    conversationLabel: string,
    content: MessageContent[],
    receive: () => Promise<ServerMessageType>,
  ): RTMessage {
    return new RTMessage(id, previousId, conversationLabel, content, receive);
  }
}

export type { RTMessage };

export interface RTConversationConfiguration {
  system_message?: string;
  voice?: Voice;
  subscribe_to_user_audio?: boolean;
  output_audio_format?: AudioFormat;
  tools?: unknown;
  tool_choice?: ToolChoice;
  temperature?: number;
  max_tokens?: number;
  disable_audio?: boolean;
}

class RTConversation implements AsyncIterable<RTMessage> {
  private allMessagesQueue: MessageQueue<ServerMessageType>;
  private messageQueue: MessageQueue<ServerMessageType>;

  private constructor(
    readonly label: string,
    private readonly client: LowLevelRTClient,
    receive: () => Promise<ServerMessageType | null>,
  ) {
    this.allMessagesQueue = new MessageQueue<ServerMessageType>(
      receive,
      (message) => {
        switch (message.event) {
          case "add_message":
            return "CONVERSATION-MESSAGE";
          case "add_content":
            return "MESSAGE";
          case "message_added":
            return "MESSAGE";
          case "generation_finished":
            return "CONVERSATION-CONTROL";
          default:
            break;
        }
        return null;
      },
    );
    this.messageQueue = new MessageQueue<ServerMessageType>(
      async () => {
        return await this.allMessagesQueue.receive("MESSAGE");
      },
      (message) => {
        switch (message.event) {
          case "add_content":
            return message.message_id;
          case "message_added":
            return message.id;
          default:
            break;
        }
        return null;
      },
    );
  }

  async configure(config: RTConversationConfiguration): Promise<void> {
    await this.client.send({ event: "update_conversation_config", ...config });
  }

  async *[Symbol.asyncIterator](): AsyncIterator<RTMessage> {
    while (true) {
      const serverMessage = await this.allMessagesQueue.receive(
        "CONVERSATION-MESSAGE",
      );
      if (serverMessage === null) {
        break;
      }
      if (serverMessage.event !== "add_message") {
        throw new Error("Unexpected message type");
      }
      const message = RTMessage._create(
        serverMessage.message.id,
        serverMessage.previous_id,
        serverMessage.conversation_label,
        serverMessage.message.content,
        async () => {
          return await this.messageQueue.receive(serverMessage.message.id);
        },
      );
      yield message;
    }
  }

  async *controlMessages(): AsyncIterable<ServerGenerationFinishedMessage> {
    while (true) {
      const message = await this.allMessagesQueue.receive(
        "CONVERSATION-CONTROL",
      );
      if (message === null) {
        break;
      }
      if (message.event !== "generation_finished") {
        throw new Error("Unexpected message type");
      }
      yield message;
    }
  }

  static _create(
    label: string,
    client: LowLevelRTClient,
    receive: () => Promise<ServerMessageType | null>,
  ) {
    return new RTConversation(label, client, receive);
  }
}

export type { RTConversation };

export interface RTSessionConfiguration {
  turn_detection?: TurnDetection;
  input_audio_format?: AudioFormat;
  transcribe_input?: boolean;
  vad?: VADConfiguration;
}

export class RTClient {
  private client: LowLevelRTClient;
  private messageQueue: MessageQueue<ServerMessageType>;
  private conversationQueue: MessageQueue<ServerMessageType>;
  private conversationMap: Map<string, string> = new Map();

  constructor(key: string);
  constructor(uri: URL, key: string);
  constructor(uriOrKey: string | URL, key?: string) {
    this.client =
      key === undefined
        ? new LowLevelRTClient(uriOrKey as string)
        : new LowLevelRTClient(uriOrKey as URL, key);
    this.messageQueue = new MessageQueue<ServerMessageType>(
      async () => {
        for await (const message of this.client.messages()) {
          return message;
        }
        return null;
      },
      (message) => {
        switch (message.event) {
          case "start_session":
          case "error":
          case "vad_speech_started":
          case "vad_speech_stopped":
          case "input_transcribed":
          case "generation_canceled":
          case "send_state":
            return "SESSION";
          case "add_message":
          case "add_content":
          case "message_added":
          case "generation_finished":
            return "CONVERSATION";
          default:
            break;
        }
        return null;
      },
    );
    this.conversationQueue = new MessageQueue<ServerMessageType>(
      async () => {
        return await this.messageQueue.receive("CONVERSATION");
      },
      (message) => {
        switch (message.event) {
          case "add_message":
            this.conversationMap.set(
              message.message.id,
              message.conversation_label,
            );
            return message.conversation_label;
          case "add_content":
            return this.conversationMap.get(message.message_id) ?? null;
          case "message_added":
            this.conversationMap.delete(message.id);
            return message.conversation_label;
          case "generation_finished":
            return message.conversation_label;
          default:
            break;
        }
        return null;
      },
    );
  }

  async configure(config: RTSessionConfiguration): Promise<void> {
    await this.client.send({ event: "update_session_config", ...config });
  }

  getDefaultConversation(): RTConversation {
    return RTConversation._create("default", this.client, async () => {
      return this.conversationQueue.receive("default");
    });
  }

  async createConversation(label: string): Promise<RTConversation> {
    if (label === "default") {
      throw new Error("Cannot create conversation with label 'default'");
    }
    await this.client.send({ event: "create_conversation", label });
    return RTConversation._create(label, this.client, async () => {
      return this.conversationQueue.receive(label);
    });
  }

  async deleteConversation(label: string): Promise<void> {
    if (label === "default") {
      throw new Error("Cannot delete conversation with label 'default'");
    }
    await this.client.send({ event: "delete_conversation", label });
  }

  async sendAudio(audio: ArrayBuffer): Promise<void> {
    const base64Encoded = Buffer.from(audio).toString("base64");
    await this.client.send({ event: "add_user_audio", data: base64Encoded });
  }

  async *controlMessages(): AsyncIterable<ServerMessageType> {
    while (true) {
      const message = await this.messageQueue.receive("SESSION");
      if (message === null) {
        break;
      }
      yield message;
    }
  }

  async close(): Promise<void> {
    await this.client.close();
  }
}
*/
