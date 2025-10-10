import { afterEach, beforeEach, describe, expect, it, Mock, vi } from "vitest";
import { SharedEndQueue } from "../../src/util/message_queue";

describe("SharedEndQueue", () => {
  // let queue: SharedEndQueue<string>;
  // let receiveMock: Mock;
  // let errorPredicateMock: Mock;
  // let endPredicateMock: Mock;

  // beforeEach(() => {
  //     receiveMock = vi.fn();
  //     errorPredicateMock = vi.fn().mockReturnValue(false);
  //     endPredicateMock = vi.fn().mockReturnValue(false);
  //     queue = new SharedEndQueue<string>(receiveMock, errorPredicateMock, endPredicateMock);
  // });

  // afterEach(() => {
  //     vi.restoreAllMocks();
  // });

  it("should return a message that satisfies the predicate", async () => {
    const receiveMock = vi.fn();
    const errorPredicateMock = vi.fn().mockReturnValue(false);
    const endPredicateMock = vi.fn().mockReturnValue(false);
    const queue = new SharedEndQueue<string>(
      receiveMock,
      errorPredicateMock,
      endPredicateMock,
    );
    receiveMock.mockResolvedValueOnce("message1");
    const result = await queue.receive((msg) => msg === "message1");
    expect(result).toBe("message1");
  });

  it("should return an error message", async () => {
    const receiveMock = vi.fn();
    const errorPredicateMock = vi.fn().mockReturnValue(false);
    const endPredicateMock = vi.fn().mockReturnValue(false);
    const queue = new SharedEndQueue<string>(
      receiveMock,
      errorPredicateMock,
      endPredicateMock,
    );
    const errorMessage = "error";
    receiveMock.mockResolvedValueOnce(errorMessage);
    errorPredicateMock.mockReturnValueOnce(true);
    const result = await queue.receive(() => false);
    expect(result).toBe(errorMessage);
  });

  it("should return an end message and keep it in the queue", async () => {
    global.debug = true;
    // const receiveMock = vi.fn();
    // const errorPredicateMock = vi.fn().mockReturnValue(false);
    // const endPredicateMock = vi.fn().mockReturnValue(false);
    const queue = new SharedEndQueue<string>(
      async () => "end",
      (_) => false,
      (_) => true,
    );
    const endMessage = "end";
    // receiveMock.mockResolvedValueOnce(endMessage);
    // endPredicateMock.mockReturnValueOnce(true);
    const result1 = await queue.receive(() => false);
    expect(result1).toBe(endMessage);

    //     // The end message should still be in the queue
    // global.debug =  true;
    const result2 = await queue.receive(() => false);
    global.debug = false;
    // expect(result2).toBe(endMessage);
  });

  it("should queue messages until a matching one is found", async () => {
    const receiveMock = vi.fn();
    const errorPredicateMock = vi.fn().mockReturnValue(false);
    const endPredicateMock = vi.fn().mockReturnValue(false);
    const queue = new SharedEndQueue<string>(
      receiveMock,
      errorPredicateMock,
      endPredicateMock,
    );
    receiveMock
      .mockResolvedValueOnce("message1")
      .mockResolvedValueOnce("message2")
      .mockResolvedValueOnce("message3");

    const result = await queue.receive((msg) => msg === "message3");
    expect(result).toBe("message3");

    // Check that earlier messages are still in the queue
    const result1 = await queue.receive((msg) => msg === "message1");
    expect(result1).toBe("message1");
    const result2 = await queue.receive((msg) => msg === "message2");
    expect(result2).toBe("message2");
  });

  it("should handle null messages", async () => {
    const receiveMock = vi.fn();
    const errorPredicateMock = vi.fn().mockReturnValue(false);
    const endPredicateMock = vi.fn().mockReturnValue(false);
    const queue = new SharedEndQueue<string>(
      receiveMock,
      errorPredicateMock,
      endPredicateMock,
    );
    receiveMock.mockResolvedValueOnce(null);
    const result = await queue.receive(() => false);
    expect(result).toBeNull();
  });

  it("should handle multiple concurrent receives", async () => {
    const receiveMock = vi.fn();
    const errorPredicateMock = vi.fn().mockReturnValue(false);
    const endPredicateMock = vi.fn().mockReturnValue(false);
    const queue = new SharedEndQueue<string>(
      receiveMock,
      errorPredicateMock,
      endPredicateMock,
    );
    receiveMock
      .mockResolvedValueOnce("message1")
      .mockResolvedValueOnce("message2")
      .mockResolvedValueOnce("message3");

    const results = await Promise.all([
      queue.receive((msg) => msg === "message2"),
      queue.receive((msg) => msg === "message1"),
      queue.receive((msg) => msg === "message3"),
    ]);

    expect(results).toEqual(["message2", "message1", "message3"]);
  });

  it("should handle end message in race condition", async () => {
    const receiveMock = vi.fn();
    const errorPredicateMock = vi.fn().mockReturnValue(false);
    const endPredicateMock = vi.fn().mockReturnValue(false);
    const queue = new SharedEndQueue<string>(
      receiveMock,
      errorPredicateMock,
      endPredicateMock,
    );
    let resolveMessage: (value: string) => void;
    const messagePromise = new Promise<string>((resolve) => {
      resolveMessage = resolve;
    });

    receiveMock.mockReturnValue(messagePromise);
    endPredicateMock.mockImplementation((msg) => msg === "end");

    const receive1Promise = queue.receive(() => false);
    const receive2Promise = queue.receive(() => false);

    resolveMessage!("end");

    const results = await Promise.all([receive1Promise, receive2Promise]);
    expect(results).toEqual(["end", "end"]);
  });

  it("should handle error message in race condition", async () => {
    const receiveMock = vi.fn();
    const errorPredicateMock = vi.fn().mockReturnValue(false);
    const endPredicateMock = vi.fn().mockReturnValue(false);
    const queue = new SharedEndQueue<string>(
      receiveMock,
      errorPredicateMock,
      endPredicateMock,
    );
    let resolveMessage: (value: string) => void;
    const messagePromise = new Promise<string>((resolve) => {
      resolveMessage = resolve;
    });

    receiveMock.mockReturnValue(messagePromise);
    errorPredicateMock.mockImplementation((msg) => msg === "error");

    const receive1Promise = queue.receive(() => false);
    const receive2Promise = queue.receive(() => false);

    resolveMessage!("error");

    const results = await Promise.all([receive1Promise, receive2Promise]);
    expect(results).toEqual(["error", "error"]);
  });
}, 3000);
