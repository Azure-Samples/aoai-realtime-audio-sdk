import { describe, it, expect, vi, beforeEach, afterEach, Mock } from "vitest";
import { MessageQueue } from "../../src/util/message_queue";

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
  let idExtractor: (message: { id: string; content: string }) => string;

  beforeEach(() => {
    receiveMock = vi.fn();
    idExtractor = (message) => message.id;
    queue = new MessageQueue(receiveMock, idExtractor);
  });

  afterEach(() => {
    vi.resetAllMocks();
  });

  it("should receive a message when one is immediately available", async () => {
    const message = { id: "1", content: "Test message" };
    receiveMock.mockImplementationOnce(delayedResolve(message, 100));

    const result = await queue.receive("1");
    expect(result).toEqual(message);
    expect(receiveMock).toHaveBeenCalledTimes(1);
  });

  it("should wait for a message when none are immediately available", async () => {
    const message = { id: "1", content: "Test message" };
    const otherMessage = { id: "2", content: "Other message" };
    receiveMock
      .mockImplementationOnce(delayedResolve(otherMessage, 100))
      .mockImplementationOnce(delayedResolve(message, 100));

    const resultPromise = queue.receive("1");
    const result = await resultPromise;

    expect(result).toEqual(message);
    expect(receiveMock).toHaveBeenCalledTimes(2);
  });

  it("should handle multiple receivers waiting for different messages", async () => {
    const message1 = { id: "1", content: "Message 1" };
    const message2 = { id: "2", content: "Message 2" };
    receiveMock
      .mockImplementationOnce(delayedResolve(message2, 100))
      .mockImplementationOnce(delayedResolve(message1, 100));

    const result1Promise = queue.receive("1");
    const result2Promise = queue.receive("2");

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
      .mockImplementationOnce(delayedResolve(message1, 100))
      .mockImplementationOnce(delayedResolve(message3, 100))
      .mockImplementationOnce(delayedResolve(message2, 100));

    const result1 = await queue.receive("1");
    const result2 = await queue.receive("2");

    expect(result1).toEqual(message1);
    expect(result2).toEqual(message2);
    expect(receiveMock).toHaveBeenCalledTimes(3);
  });

  it("should stop polling when receive delegate returns null", async () => {
    const message = { id: "1", content: "Test message" };
    receiveMock.mockResolvedValueOnce(message).mockResolvedValue(null);

    const result1 = await queue.receive("1");
    expect(result1).toEqual(message);

    const result2Promise = queue.receive("2");

    const result2 = await result2Promise;
    expect(result2).toBeNull();
    expect(receiveMock).toHaveBeenCalledTimes(2);
  });

  it("should handle messages with null IDs", async () => {
    const messageWithNullId = { id: "null", content: "Ignored message" };
    const validMessage = { id: "1", content: "Valid message" };
    receiveMock
      .mockResolvedValueOnce(messageWithNullId)
      .mockResolvedValueOnce(validMessage);

    const idExtractorWithNull = (message: { id: string; content: string }) =>
      message.id === "null" ? null : message.id;
    queue = new MessageQueue(receiveMock, idExtractorWithNull);

    const result = await queue.receive("1");
    expect(result).toEqual(validMessage);
    expect(receiveMock).toHaveBeenCalledTimes(2);
  });

  it("should handle errors in the receive delegate", async () => {
    const error = new Error("Receive error");
    receiveMock.mockRejectedValue(error);

    await expect(queue.receive("1")).rejects.toThrow("Receive error");
  });
});
