// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

type ReceiveFunction<T> = () => Promise<T | null>;
type IdExtractor<T> = (message: T) => string | null;

type ResolveFn<T> = (value: T | null) => void;
type RejectFn<E> = (reason: E) => void;

export class MessageQueue<T> {
  private messages: T[] = [];
  private waitingReceivers: Map<string, [ResolveFn<T>, RejectFn<Error>][]> =
    new Map();
  private isPolling: boolean = false;

  constructor(
    private receiveDelegate: ReceiveFunction<T>,
    private readonly idExtractor: IdExtractor<T>,
  ) {}

  private async pollReceive(): Promise<void> {
    if (this.isPolling) {
      return;
    }

    try {
      this.isPolling = true;
      while (this.isPolling) {
        const message = await this.receiveDelegate();
        if (!message) {
          this.notifyEndOfStream();
          break;
        }
        this.notifyReceiver(message);
      }
    } catch (error) {
      this.notifyError(error);
    } finally {
      this.isPolling = false;
    }
  }

  private notifyError(error: Error): void {
    for (const [, receivers] of this.waitingReceivers) {
      for (const [_, reject] of receivers) {
        reject(error);
      }
    }
    this.waitingReceivers.clear();
  }

  private notifyEndOfStream(): void {
    for (const [, receivers] of this.waitingReceivers) {
      for (const [resolve, _] of receivers) {
        resolve(null);
      }
    }
    this.waitingReceivers.clear();
  }

  private notifyReceiver(message: T): void {
    const id = this.idExtractor(message);
    if (id === null) {
      /* If the extractor return null, the message is not relevant for this queue */
      return;
    }
    if (!this.waitingReceivers.has(id)) {
      /* If no listeners are waiting for this id, queue it for later consumption */
      this.messages.push(message);
      return;
    }

    const [resolve, _] = this.waitingReceivers.get(id)!.shift()!;
    if (this.waitingReceivers.get(id)?.length === 0) {
      this.waitingReceivers.delete(id);
    }
    resolve!(message);

    if (this.getAllWaitingReceiversCount() === 0) {
      this.isPolling = false;
    }
  }

  private getAllWaitingReceiversCount(): number {
    return Array.from(this.waitingReceivers.values()).reduce(
      (sum, receivers) => sum + receivers.length,
      0,
    );
  }

  async receive(receiverId: string): Promise<T | null> {
    return new Promise<T | null>((resolve, reject) => {
      const foundIndex = this.messages.findIndex((message) => {
        this.idExtractor(message) == receiverId;
      });
      if (foundIndex >= 0) {
        const foundMessage = this.messages.splice(foundIndex, 1)[0];
        return resolve(foundMessage);
      }
      if (!this.waitingReceivers.has(receiverId)) {
        this.waitingReceivers.set(receiverId, []);
      }
      this.waitingReceivers.get(receiverId)!.push([resolve, reject]);

      if (!this.isPolling) {
        this.pollReceive();
      }
    });
  }
}
