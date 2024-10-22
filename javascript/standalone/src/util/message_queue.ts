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
    AbortController,
  ][] = [];
  private isPolling: boolean = false;
  private pollPromise: Promise<void> | null = null;

  constructor(private receiveDelegate: ReceiveFunction<T>) {}

  protected pushBack(message: T) {
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
    if (this.isPolling) {
      return;
    }

    this.isPolling = true;
    this.pollPromise = this.doPollReceive();
    return this.pollPromise;
  }

  private async doPollReceive(): Promise<void> {
    try {
      while (this.isPolling) {
        const message = await this.receiveDelegate();
        if (message === null) {
          this.notifyEndOfStream();
          break;
        }
        this.notifyReceiver(message);
        if (this.waitingReceivers.length === 0) {
          break;
        }
      }
    } catch (error) {
      this.notifyError(error);
    } finally {
      this.isPolling = false;
      this.pollPromise = null;
    }
  }

  private notifyError(error: Error): void {
    while (this.waitingReceivers.length > 0) {
      const [_predicate, [_resolve, reject], _controller] =
        this.waitingReceivers.shift()!;
      reject(error);
    }
  }

  private notifyEndOfStream(): void {
    while (this.waitingReceivers.length > 0) {
      const [_predicate, [resolve, _reject], _controller] =
        this.waitingReceivers.shift()!;
      resolve(null);
    }
  }

  protected notifyReceiver(message: T): void {
    const index = this.waitingReceivers.findIndex(
      ([predicate, [_resolve, _reject], _controller]) => predicate(message),
    );
    if (index === -1) {
      this.pushBack(message);
      return;
    }

    const [_predicate, [resolve, _reject], _controller] =
      this.waitingReceivers.splice(index, 1)[0];
    resolve(message);
  }

  queuedMessageCount(): number {
    return this.messages.length;
  }

  receive(predicate: Predicate<T>, abort?: AbortController): Promise<T | null> {
    const foundMessage = this.findAndRemove(predicate);
    if (foundMessage !== null) {
      return Promise.resolve(foundMessage);
    }

    return new Promise<T | null>(async (resolve, reject) => {
      this.waitingReceivers.push([
        predicate,
        [resolve, reject],
        abort || new AbortController(),
      ]);

      await this.pollReceive();
    });
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

  protected notifyReceiver(message: T): void {
    if (this.errorPredicate(message)) {
      this.error = message;
      this.notifyErrorMessage(message);
      return;
    }
    const index = this.waitingReceivers.findIndex(
      ([predicate, [_resolve, _reject], _controller]) => predicate(message),
    );
    if (index === -1) {
      this.pushBack(message);
      return;
    }

    const [_predicate, [resolve, _reject], _controller] =
      this.waitingReceivers.splice(index, 1)[0];
    resolve(message);
  }

  async receive(predicate: (message: T) => boolean): Promise<T | null> {
    if (this.error !== undefined) {
      return this.error;
    }
    const message = await super.receive(
      (message) => predicate(message) || this.errorPredicate(message),
    );
    return message;
  }
}

export class SharedEndQueue<T> {
  private queue: T[] = [];
  private lock: Promise<void> = Promise.resolve();

  constructor(
    private receiveDelegate: () => Promise<T>,
    private errorPredicate: (message: T) => boolean,
    private endPredicate: (message: T) => boolean,
  ) {}

  async receive(predicate: (message: T) => boolean): Promise<T> {
    const release = await this.acquireLock();
    try {
      for (let i = 0; i < this.queue.length; i++) {
        const message = this.queue[i];
        if (predicate(message)) {
          this.queue.splice(i, 1);
          return message;
        } else if (this.endPredicate(message)) {
          return message;
        }
      }

      while (true) {
        const message = await this.receiveDelegate();
        if (
          message === null ||
          this.errorPredicate(message) ||
          predicate(message)
        ) {
          return message;
        }
        if (this.endPredicate(message)) {
          this.queue.push(message);
          return message;
        }
        this.queue.push(message);
      }
    } finally {
      release();
    }
  }

  private async acquireLock(): Promise<() => void> {
    let release: () => void;
    const newLock = new Promise<void>((resolve) => {
      release = resolve;
    });
    const oldLock = this.lock;
    this.lock = newLock;
    await oldLock;
    return release!;
  }
}
