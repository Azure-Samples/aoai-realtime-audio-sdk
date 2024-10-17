// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

import { describe, it, expect, vi, beforeEach, afterEach, Mock } from "vitest";
import { MessageQueue, MessageQueueWithError } from "../../src/util/message_queue";

async function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function delayedResolve<T>(value: T, ms: number): () => Promise<T> {
  return async () => {
    await delay(ms);
    return value;
  };
}

describe("MessageQueue", () => {
  let queue: MessageQueue<{ id: string; content: string }>;
  let receiveMock: Mock;

  beforeEach(() => {
    receiveMock = vi.fn();
    queue = new MessageQueue(receiveMock);
  });

  afterEach(() => {
    vi.resetAllMocks();
  });

  it("should receive a message when one is immediately available", async () => {
    const message = { id: "1", content: "Test message" };
    receiveMock.mockImplementationOnce(delayedResolve(message, 100));

    const result = await queue.receive((m) => m.id === "1");
    expect(result).toEqual(message);
    expect(receiveMock).toHaveBeenCalledTimes(1);
  });

  it("should wait for a message when none are immediately available", async () => {
    const message = { id: "1", content: "Test message" };
    const otherMessage = { id: "2", content: "Other message" };
    receiveMock
      .mockImplementationOnce(delayedResolve(otherMessage, 100))
      .mockImplementationOnce(delayedResolve(message, 100))
      .mockImplementationOnce(delayedResolve(null, 100));

    const resultPromise = queue.receive((m) => m.id == "1");
    const result = await resultPromise;

    expect(result).toEqual(message);
    expect(receiveMock).toHaveBeenCalledTimes(2);
  });

  it("should handle multiple receivers waiting for different messages", async () => {
    const message1 = { id: "1", content: "Message 1" };
    const message2 = { id: "2", content: "Message 2" };
    receiveMock
      .mockImplementationOnce(delayedResolve(message2, 100))
      .mockImplementationOnce(delayedResolve(message1, 100))
      .mockImplementationOnce(delayedResolve(null, 100));

    const result1Promise = queue.receive((m) => m.id === "1");
    const result2Promise = queue.receive((m) => m.id === "2");

    const [result1, result2] = await Promise.all([
      result1Promise,
      result2Promise,
    ]);

    expect(result1).toEqual(message1);
    expect(result2).toEqual(message2);
    expect(receiveMock).toHaveBeenCalledTimes(2);
  });

  it("should queue messages for receivers that are not yet waiting", async () => {
    const message1 = { id: "1", content: "Message 1" };
    const message2 = { id: "2", content: "Message 2" };
    const message3 = { id: "3", content: "Message 3" };
    receiveMock
      .mockResolvedValue(null)
      .mockResolvedValueOnce(message1)
      .mockResolvedValueOnce(message3)
      .mockResolvedValueOnce(message2)
      .mockResolvedValueOnce(null);

    const result1 = await queue.receive((m) => m.id === "1");
    const result2 = await queue.receive((m) => m.id === "2");

    expect(result1).toEqual(message1);
    expect(result2).toEqual(message2);
    expect(receiveMock).toHaveBeenCalledTimes(3);
    expect(queue.queuedMessageCount()).toBe(1);
  });

  it("should stop polling when receive delegate returns null", async () => {
    const message = { id: "1", content: "Test message" };
    receiveMock.mockResolvedValueOnce(message).mockResolvedValue(null);

    const result1 = await queue.receive((m) => m.id === "1");
    expect(result1).toEqual(message);

    const result2Promise = queue.receive((m) => m.id === "2");

    const result2 = await result2Promise;
    expect(result2).toBeNull();
    expect(receiveMock).toHaveBeenCalledTimes(2);
  });

  it("should handle errors in the receive delegate", async () => {
    const error = new Error("Receive error");
    receiveMock.mockRejectedValue(error);

    await expect(queue.receive((m) => m.id === "1")).rejects.toThrow(
      "Receive error",
    );
  });
}, 3500);


describe('MessageQueueWithError', () => {
  let mockReceiveDelegate: ReturnType<typeof vi.fn>;
  let errorPredicate: ReturnType<typeof vi.fn>;
  let queue: MessageQueueWithError<string>;


  beforeEach(() => {
    mockReceiveDelegate = vi.fn();
    errorPredicate = vi.fn();
    queue = new MessageQueueWithError<string>(mockReceiveDelegate, errorPredicate);
  });

  afterEach(() => {
    // vi.useRealTimers();
    vi.resetAllMocks();
  });

  it('should return normal messages when no error occurs', async () => {
    mockReceiveDelegate.mockResolvedValueOnce('message1');
    errorPredicate.mockReturnValue(false);

    const result = await queue.receive((m) => m === "message1");
    expect(result).toBe('message1');
  });

  it('should return error message and enter terminal state', async () => {
    mockReceiveDelegate.mockResolvedValueOnce('error_message');
    errorPredicate.mockReturnValue(true);

    const result1 = await queue.receive(() => false);
    expect(result1).toBe('error_message');

    const result2 = await queue.receive(() => false);
    expect(result2).toBe('error_message');

    expect(mockReceiveDelegate).toHaveBeenCalledTimes(1);
  });

  it('should notify all pending receivers when error occurs', async () => {
    mockReceiveDelegate.mockImplementation(delayedResolve('error_message', 100));
    errorPredicate.mockReturnValue(true);

    const promise1 = queue.receive(() => false);
    const promise2 = queue.receive(() => false);
    const promise3 = queue.receive(() => false);

    const results = await Promise.all([promise1, promise2, promise3]);

    expect(results).toEqual(['error_message', 'error_message', 'error_message']);
    expect(mockReceiveDelegate).toHaveBeenCalledTimes(1);
  });

  it('should handle null messages correctly', async () => {
    mockReceiveDelegate.mockResolvedValueOnce(null);

    const result = await queue.receive(() => false);
    expect(result).toBeNull();
  });

// //   it('should respect the predicate for non-error messages', async () => {
// //     mockReceiveDelegate.mockResolvedValueOnce('message1');
// //     mockReceiveDelegate.mockResolvedValueOnce('message2');
// //     errorPredicate.mockReturnValue(false);

// //     const result1 = await queue.receive(msg => msg === 'message2');
// //     expect(result1).toBe('message2');

// //     const result2 = await queue.receive(msg => msg === 'message1');
// //     expect(result2).toBe('message1');
// //   });

// //   it('should handle errors in receiveDelegate', async () => {
// //     const error = new Error('Receive error');
// //     mockReceiveDelegate.mockRejectedValueOnce(error);

// //     await expect(queue.receive(() => true)).rejects.toThrow('Receive error');
// //   });
}, 100);