// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

type ResolveFn<T> = (value: IteratorResult<T>) => void;
type RejectFn<E> = (reason: E) => void;

interface BinaryWebSocketMessage {
    type: "binary";
    data: ArrayBuffer;
}

interface TextWebSocketMessage {
    type: "text";
    data: string;
}

type WebSocketMessage = BinaryWebSocketMessage | TextWebSocketMessage;

export class WebSocketClient implements AsyncIterable<WebSocketMessage> {
  private socket: WebSocket | undefined;
  private connectedPromise: Promise<void>;
  private closedPromise: Promise<void> | undefined = undefined;
  private error: Error | undefined;
  private messageQueue: WebSocketMessage[] = [];

  private receiverQueue: [ResolveFn<WebSocketMessage>, RejectFn<Error>][] = [];
  private done: boolean = false;

  constructor(
    url: URL,
  ) {
    this.connectedPromise = new Promise(async (resolve, reject) => {
      this.socket = new WebSocket(url);
      this.socket.binaryType = "arraybuffer";
      this.socket.onopen = () => {
        this.socket!.onmessage = (ev: MessageEvent) => this.messageHandler(ev);
        this.closedPromise = new Promise((resolve) => {
          this.socket!.onclose = this.getClosedHandler(resolve);
        });
        this.socket!.onerror = (ev: Event) => this.handleError(ev);
        resolve();
      };
      this.socket.onerror = (ev: Event) => {
        this.error = (ev as ErrorEvent).error || new Error("Unknown error");
        reject(ev);
      };
    });
  }

  private handleError(event: Event) {
    this.error = (event as ErrorEvent).error || new Error("Unknown error");
    while (this.receiverQueue.length > 0) {
      const [_, reject] = this.receiverQueue.shift()!;
      reject(this.error!);
    }
  }

  private getClosedHandler(
    closeResolve: (_: void) => void,
  ): (_: CloseEvent) => void {
    return (_: CloseEvent) => {
      this.done = true;
      while (this.receiverQueue.length > 0) {
        const [resolve, reject] = this.receiverQueue.shift()!;
        if (this.error) {
          reject(this.error);
        } else {
          resolve({ value: undefined, done: true });
        }
      }
      closeResolve();
    };
  }

  private messageHandler(event: MessageEvent) {
    const data = event.data;
    const message: WebSocketMessage = (data instanceof ArrayBuffer) ? { type: "binary", data } : { type: "text", data };
    if (this.receiverQueue.length > 0) {
        const [resolve, _] = this.receiverQueue.shift()!;
        resolve({ value: message, done: false });
    } else {
        this.messageQueue.push(message);
    }
  }

  [Symbol.asyncIterator](): AsyncIterator<WebSocketMessage> {
    return {
      next: (): Promise<IteratorResult<WebSocketMessage>> => {
        if (this.error) {
          return Promise.reject(this.error);
        } else if (this.done) {
          return Promise.resolve({ value: undefined, done: true });
        } else if (this.messageQueue.length > 0) {
          const message = this.messageQueue.shift()!;
          return Promise.resolve({ value: message, done: false });
        } else {
          return new Promise((resolve, reject) => {
            this.receiverQueue.push([resolve, reject]);
          });
        }
      },
    };
  }

  async send(message: WebSocketMessage): Promise<void> {
    await this.connectedPromise;
    if (this.error) {
      throw this.error;
    }
    if (this.socket?.readyState !== WebSocket.OPEN) {
        throw new Error("WebSocket is not open");
    }
    this.socket.send(message.data);
  }

  async close(): Promise<void> {
    await this.connectedPromise;
    if (this.done) {
      return;
    }

    if (this.socket?.readyState === WebSocket.OPEN) {
        this.socket!.close();
        await this.closedPromise;
    }
  }
}
