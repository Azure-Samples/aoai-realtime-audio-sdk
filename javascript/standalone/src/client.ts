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
import { MessageQueue } from "./util/message_queue";

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

export class RTClient {
  private client: LowLevelRTClient;
  private messageQueue: MessageQueue<ServerMessageType>;

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
  }

  get requestId(): string | undefined {
    return this.client.requestId;
  }
}
