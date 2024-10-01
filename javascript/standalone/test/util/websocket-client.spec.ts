import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  WebSocketClient,
  ConnectionSettings,
  MessageProtocolHandler,
  validationSuccess,
  validationError,
} from "../../src/util/websocket-client";

interface EchoServerMessage<T> {
  type: "message" | "greeting";
  payload?: T;
}

describe("WebSocketClient", () => {
  let client: WebSocketClient<string, EchoServerMessage<string>>;
  const echoServerUrl = "wss://echo.websocket.org";

  const settings: ConnectionSettings = {
    uri: new URL(echoServerUrl),
  };

  const handler: MessageProtocolHandler<string, EchoServerMessage<string>> = {
    validate: (event) => {
      if (typeof event.data === "string") {
        if (/^Request served by \w+$/.test(event.data)) {
          return validationSuccess({ type: "greeting" });
        }
        return validationSuccess({ type: "message", payload: event.data });
      }
      return validationError<EchoServerMessage<string>>(
        new Error("Invalid message format"),
      );
    },
    serialize: (message) => message,
  };

  beforeEach(() => {
    client = new WebSocketClient(settings, handler);
  });

  afterEach(async () => {
    await client.close();
  });

  it("should connect to the echo server", async () => {
    const testMessage = "Hello, WebSocket!";
    await client.send(testMessage);
    for await (const message of client) {
      if (message.type === "greeting") {
        continue;
      }
      expect(message.payload).toBe(testMessage);
      break;
    }
  });

  it("should handle multiple messages", async () => {
    const messages = ["Message 1", "Message 2", "Message 3"];
    const receivedMessages: string[] = [];

    // Send all messages
    for (const msg of messages) {
      await client.send(msg);
    }

    // Receive all messages
    for await (const message of client) {
      if (message.type === "greeting") {
        continue;
      }
      receivedMessages.push(message.payload!);
      if (receivedMessages.length === messages.length) {
        break;
      }
    }

    expect(receivedMessages).toEqual(messages);
  });

  it("should handle errors", async () => {
    const invalidHandler: MessageProtocolHandler<string, string> = {
      ...handler,
      validate: () => ({ success: false, error: new Error("Invalid message") }),
    };

    const errorClient = new WebSocketClient(settings, invalidHandler);

    await errorClient.send("This should cause an error");

    await expect(async () => {
      for await (const _ of errorClient) {
        // This should throw an error
      }
    }).rejects.toThrow("Invalid message");

    await errorClient.close();
  });

  it("should close the connection", async () => {
    await client.send("Test message");
    await client.close();

    // Trying to send a message after closing should throw an error
    await expect(client.send("This should fail")).rejects.toThrow();
  });
});
