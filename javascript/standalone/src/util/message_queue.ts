// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

type ReceiveFunction<T> = () => Promise<T | null>;

type ResolveFn<T> = (value: T | null) => void;
type RejectFn<E> = (reason: E) => void;

type Predicate<T> = (message: T) => boolean;

export class MessageQueue<T> {
  private messages: T[] = [];
  protected waitingReceivers: [
    Predicate<T>,
    [ResolveFn<T>, RejectFn<Error>],
    AbortController
  ][] = [];
  private isPolling: boolean = false;
  private pollPromise: Promise<void> | null = null;

  constructor(private receiveDelegate: ReceiveFunction<T>) {}

  private pushBack(message: T) {
    this.messages.push(message);
  }

  private findAndRemove(predicate: Predicate<T>): T | null {
    const index = this.messages.findIndex(predicate);
    if (index === -1) {
      return null;
    }
    return this.messages.splice(index, 1)[0];
  }

  private async pollReceive(): Promise<void> {
    console.log("pollReceive");
    if (this.isPolling) {
      console.log("pollReceive: already polling");
      return this.pollPromise;
    }

    this.isPolling = true;
    this.pollPromise = this.doPollReceive();
    return this.pollPromise;
  }

  private async doPollReceive(): Promise<void> {
    try {
      while (this.isPolling) {
        console.log("pollReceive: polling");
        const message = await this.receiveDelegate();
        console.log("pollReceive: received message", message);
        if (message === null) {
          console.log("pollReceive: end of stream");
          this.notifyEndOfStream();
          break;
        }
        this.notifyReceiver(message);
        if (this.waitingReceivers.length === 0 && this.messages.length === 0) {
          console.log("pollReceive: no more waiting receivers or queued messages");
          break;
        }
      }
    } catch (error) {
      console.log("pollReceive: error", error);
      this.notifyError(error);
    } finally {
      console.log("pollReceive: finally");
      this.isPolling = false;
      this.pollPromise = null;
    }
  }

  private notifyError(error: Error): void {
    while (this.waitingReceivers.length > 0) {
      const [_predicate, [_resolve, reject], _controller] = this.waitingReceivers.shift()!;
      reject(error);
    }
  }

  private notifyEndOfStream(): void {
    while (this.waitingReceivers.length > 0) {
      const [_predicate, [resolve, _reject], _controller] = this.waitingReceivers.shift()!;
      resolve(null);
    }
  }

  private notifyReceiver(message: T): void {
    const index = this.waitingReceivers.findIndex(
      ([predicate, [_resolve, _reject], _controller]) => predicate(message),
    );
    console.log("notifyReceiver", index, message);
    if (index === -1) {
      this.pushBack(message);
      console.log("notifyReceiver: pushed back message", message);
      return;
    }

    const [_predicate, [resolve, _reject], _controller] = this.waitingReceivers.splice(
      index,
      1,
    )[0];
    resolve(message);
  }

  queuedMessageCount(): number {
    return this.messages.length;
  }

  receive(predicate: (message: T) => boolean): { promise: Promise<T | null>; cancel: () => void } {
    const foundMessage = this.findAndRemove(predicate);
    if (foundMessage !== null) {
      return {
        promise: Promise.resolve(foundMessage),
        cancel: () => {} // No-op for immediately resolved promises
      };
    }

    const controller = new AbortController();
    let resolvePromise: ResolveFn<T>, rejectPromise: RejectFn<Error>;

    const promise = new Promise<T | null>((resolve, reject) => {
      resolvePromise = resolve;
      rejectPromise = reject;

      this.waitingReceivers.push([predicate, [resolve, reject], controller]);
      this.pollReceive().catch(reject);

      controller.signal.addEventListener('abort', () => {
        const index = this.waitingReceivers.findIndex(
          ([_pred, [_res, _rej], ctrl]) => ctrl === controller
        );
        if (index !== -1) {
          this.waitingReceivers.splice(index, 1);
          reject(new Error('Receive operation cancelled'));
        }
      });
    });

    return {
      promise,
      cancel: () => controller.abort()
    };
  }
}
export class MessageQueueWithError<T> extends MessageQueue<T> {
  private error?: T = undefined;

  constructor(
    receiveDelegate: ReceiveFunction<T>,
    private errorPredicate: (message: T) => boolean,
  ) {
    super(receiveDelegate);
  }

  private notifyErrorMessage(message: T): void {
    while (this.waitingReceivers.length > 0) {
      const [_, [resolve, _reject]] = this.waitingReceivers.shift()!;
      resolve(message);
    }
  }

  async receive(predicate: (message: T) => boolean): Promise<T | null> {
    if (this.error !== undefined) {
      return this.error;
    }
    const message = await super.receive((message) => predicate(message) || this.errorPredicate(message));
    if (message !== null && this.errorPredicate(message)) {
      this.error = message;
      this.notifyErrorMessage(message);
      return message;
    }
    return message;
  }
}
