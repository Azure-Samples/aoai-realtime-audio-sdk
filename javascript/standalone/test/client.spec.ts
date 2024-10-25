// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

import { afterEach, assert, beforeEach, describe, expect, it } from "vitest";
import { LowLevelRTClient, RTClient } from "../src/client";
import {
  azureOpenAIDeployment,
  azureOpenAIEndpoint,
  azureOpenAIKey,
  openAIKey,
  openAIModel,
  runAzureOpenAILiveTests,
  runOpenAILiveTests,
} from "./test-util";
import { readInputFile, testFilePath } from "./file-utils";

describe.each([
  [
    "OpenAI",
    () => new LowLevelRTClient({ key: openAIKey! }, { model: openAIModel! }),
    runOpenAILiveTests,
  ],
  [
    "AzureOpenAI",
    () =>
      new LowLevelRTClient(
        new URL(azureOpenAIEndpoint!),
        { key: azureOpenAIKey! },
        { deployment: azureOpenAIDeployment! },
      ),
    runAzureOpenAILiveTests,
  ],
])("LowLevelRTClient", (tag, factory, flag) => {
  let client: LowLevelRTClient;
  beforeEach(() => {
    client = factory();
  });

  describe.runIf(flag)(
    tag,
    async () => {
      it("should send and receive messages", async () => {
        const newInstruction =
          "You are a helpful assistant that talks like a pirate.";
        await client.send({
          type: "session.update",
          session: {
            instructions: newInstruction,
          },
        });
        for await (const message of client.messages()) {
          expect(message.type in ["session.created", "session.updated"]);
          if (message.type === "session.created") {
            expect(message.session.instructions !== newInstruction);
          } else if (message.type === "session.updated") {
            expect(message.session.instructions === newInstruction);
            client.close();
          }
        }
      });
    },
    10000,
  );
});

describe.each([
  [
    "OpenAI",
    () => new RTClient({ key: openAIKey! }, { model: openAIModel! }),
    runOpenAILiveTests,
  ],
  [
    "AzureOpenAI",
    () =>
      new RTClient(
        new URL(azureOpenAIEndpoint!),
        { key: azureOpenAIKey! },
        { deployment: azureOpenAIDeployment! },
      ),
    runAzureOpenAILiveTests,
  ],
])("RTClient (%s)", (tag, factory, flag) => {
  let client: RTClient;
  beforeEach(() => {
    client = factory();
  });

  describe.runIf(flag)(
    tag,
    async () => {
      let client: RTClient;

      beforeEach(() => {
        client = new RTClient({ key: openAIKey! }, { model: openAIModel! });
      });

      afterEach(async () => {
        await client.close();
      });

      it("should properly resolve init", async () => {
        await client.init();
        expect(client.session).toBeDefined();
      });

      it("configure should properly update the session", async () => {
        await client.init();
        const oldInstruction = client.session?.instructions;
        const newInstruction =
          "You are a helpful assistant that talks like a pirate.";
        await client.configure({ instructions: newInstruction });
        expect(client.session?.instructions).toBe(newInstruction);
        expect(client.session?.instructions).not.toBe(oldInstruction);
      });

      it("commit audio with transcription should generate and resolve an input item", async () => {
        const filePath = testFilePath("arc-easy-q237-tts.raw");
        await client.configure({
          turn_detection: null,
          input_audio_transcription: {
            model: "whisper-1",
          },
        });

        for await (const chunk of readInputFile(filePath, 8192)) {
          await client.sendAudio(chunk);
        }
        const item = await client.commitAudio();

        expect(item).toBeDefined();
        expect(item.transcription).toBeUndefined();

        await item.waitForCompletion();

        expect(item.transcription).toBeDefined();
        expect(item.transcription?.length).toBeGreaterThan(0);
      });

      it("commit audio without transcription should generate and resolve an input item", async () => {
        const filePath = testFilePath("arc-easy-q237-tts.raw");
        await client.configure({
          turn_detection: null,
          input_audio_transcription: null,
        });

        for await (const chunk of readInputFile(filePath, 8192)) {
          await client.sendAudio(chunk);
        }
        const item = await client.commitAudio();

        expect(item).toBeDefined();
        expect(item.transcription).toBeUndefined();

        await item.waitForCompletion();

        expect(item.transcription).toBeUndefined();
      });

      it("clear audio should properly clean the input buffer", async () => {
        const filePath = testFilePath("arc-easy-q237-tts.raw");
        await client.configure({
          turn_detection: null,
        });

        for await (const chunk of readInputFile(filePath, 8192)) {
          await client.sendAudio(chunk);
        }
        await client.clearAudio();

        expect(() => client.commitAudio()).rejects.toThrow("buffer");
      });

      it("send should properly resolve and populate the message id", async () => {
        const item = await client.sendItem({
          type: "message",
          role: "user",
          content: [
            {
              type: "input_text",
              text: "This is my first message!",
            },
          ],
        });
        expect(item).toBeDefined();
        expect(item.id).toBeDefined();
        expect(item.id!.length).toBeGreaterThan(0);
      });

      it("removeItem should properly result in the item being removed", async () => {
        const item = await client.sendItem({
          type: "message",
          role: "user",
          content: [
            {
              type: "input_text",
              text: "This is my first message!",
            },
          ],
        });
        expect(item).toBeDefined();

        await client.removeItem(item.id!);

        expect(() =>
          client.sendItem(
            {
              type: "message",
              role: "user",
              content: [
                {
                  type: "input_text",
                  text: "This is my second message!",
                },
              ],
            },
            item.id!,
          ),
        ).rejects.toThrow("does not exist");
      });

      it("generate response properly generates a response when there's input", async () => {
        await client.configure({ modalities: ["text"], turn_detection: null });
        const sentItem = await client.sendItem({
          type: "message",
          role: "user",
          content: [
            {
              type: "input_text",
              text: "Repeat exactly the following sentence: Hello, world!",
            },
          ],
        });
        const response = await client.generateResponse();
        expect(response).toBeDefined();
        expect(response.id).toBeDefined();
        expect(response.id!.length).toBeGreaterThan(0);
        for await (const item of response) {
          expect(item).toBeDefined();
          expect(item.responseId).toBe(response.id);
          expect(item.previousItemId).toBe(sentItem.id);
        }
      });

      it("cancel should properly cancel a response", async () => {
        await client.configure({ modalities: ["text"], turn_detection: null });
        const _ = await client.sendItem({
          type: "message",
          role: "user",
          content: [
            {
              type: "input_text",
              text: "Repeat exactly the following sentence: Hello, world!",
            },
          ],
        });
        const response = await client.generateResponse();
        await response.cancel();

        let itemCount = 0;
        for await (const _item of response) {
          itemCount++;
        }
        expect(itemCount).toBe(0);
        expect(["cancelled", "completed"].includes(response.status));
      });

      it("items should properly be emitted for text in text out", async () => {
        await client.configure({ modalities: ["text"], turn_detection: null });
        const _ = await client.sendItem({
          type: "message",
          role: "user",
          content: [
            {
              type: "input_text",
              text: "Repeat exactly the following sentence: Hello, world!",
            },
          ],
        });
        const response = await client.generateResponse();

        for await (const item of response) {
          expect(item.type).toBe("message");
          assert(item.type === "message");
          for await (const part of item) {
            expect(part.type).toBe("text");
            let text = "";
            assert(part.type === "text");
            for await (const chunk of part.textChunks()) {
              text += chunk;
            }
            expect(text).toBe(part.text);
          }
        }
      });

      it("items should properly be emitted for text in audio out", async () => {
        await client.configure({
          modalities: ["text", "audio"],
          turn_detection: null,
        });
        const _ = await client.sendItem({
          type: "message",
          role: "user",
          content: [
            {
              type: "input_text",
              text: "Repeat exactly the following sentence: Hello, world!",
            },
          ],
        });
        const response = await client.generateResponse();

        for await (const item of response) {
          expect(item.type).toBe("message");
          assert(item.type === "message");
          for await (const part of item) {
            expect(part.type).toBe("audio");
            assert(part.type === "audio");
            let byteCount = 0;
            for await (const chunk of part.audioChunks()) {
              expect(chunk).toBeDefined();
              byteCount += chunk.length;
            }
            expect(byteCount).toBeGreaterThan(0);
            let transcript = "";
            for await (const chunk of part.transcriptChunks()) {
              transcript += chunk;
            }
            expect(transcript).toBe(part.transcript);
          }
        }
      });

      describe("function calling", () => {
        const functionDeclarations = {
          get_weather_by_location: {
            name: "get_weather_by_location",
            type: "function",
            description: "A function to get the weather based on a location.",
            parameters: {
              type: "object",
              properties: {
                city: {
                  type: "string",
                  description: "The name of the city to get the weather for.",
                },
              },
              required: ["city"],
            },
          },
        };
        it("function call item should properly be resolved by chunks", async () => {
          await client.configure({
            modalities: ["text"],
            tools: [functionDeclarations["get_weather_by_location"]],
            turn_detection: null,
          });
          const _ = await client.sendItem({
            type: "message",
            role: "user",
            content: [
              {
                type: "input_text",
                text: "What's the weather like in Seattle, Washington?",
              },
            ],
          });
          const response = await client.generateResponse();

          for await (const item of response) {
            expect(item.type).toBe("function_call");
            assert(item.type === "function_call");
            expect(item.functionName).toBe("get_weather_by_location");

            let args = "";
            for await (const chunk of item) {
              expect(chunk).toBeDefined();
              args += chunk;
            }
            expect(args).toBe(item.arguments);
          }
        });

        it("function call item should properly be resolved waiting for completion", async () => {
          await client.configure({
            modalities: ["text"],
            tools: [functionDeclarations["get_weather_by_location"]],
            turn_detection: null,
          });
          const _ = await client.sendItem({
            type: "message",
            role: "user",
            content: [
              {
                type: "input_text",
                text: "What's the weather like in Seattle, Washington?",
              },
            ],
          });
          const response = await client.generateResponse();

          for await (const item of response) {
            expect(item.type).toBe("function_call");
            assert(item.type === "function_call");
            expect(item.functionName).toBe("get_weather_by_location");

            await item.waitForCompletion();
            expect(item.arguments).toBeDefined();
            expect(item.arguments.length).toBeGreaterThan(0);
            const argsJSON = JSON.parse(item.arguments);
            expect(argsJSON).toBeDefined();
            expect(argsJSON.city).toBeDefined();
          }
        });

        it("function call item should throw if using waitForCompletion after iterating", async () => {
          await client.configure({
            modalities: ["text"],
            tools: [functionDeclarations["get_weather_by_location"]],
            turn_detection: null,
          });
          const _ = await client.sendItem({
            type: "message",
            role: "user",
            content: [
              {
                type: "input_text",
                text: "What's the weather like in Seattle, Washington?",
              },
            ],
          });
          const response = await client.generateResponse();

          for await (const item of response) {
            expect(item.type).toBe("function_call");
            assert(item.type === "function_call");
            expect(item.functionName).toBe("get_weather_by_location");

            for await (const _ of item) {
              // Do nothing
            }
            expect(item.waitForCompletion()).rejects.toThrow(
              "Cannot await after iterating",
            );
          }
        });

        it("function call item should throw if trying to iterate after calling waitForCompletion", async () => {
          await client.configure({
            modalities: ["text"],
            tools: [functionDeclarations["get_weather_by_location"]],
            turn_detection: null,
          });
          const _ = await client.sendItem({
            type: "message",
            role: "user",
            content: [
              {
                type: "input_text",
                text: "What's the weather like in Seattle, Washington?",
              },
            ],
          });
          const response = await client.generateResponse();

          for await (const item of response) {
            expect(item.type).toBe("function_call");
            assert(item.type === "function_call");
            expect(item.functionName).toBe("get_weather_by_location");

            await item.waitForCompletion();
            expect(async () => {
              for await (const _ of item) {
                // Do nothing
              }
            }).rejects.toThrow("Cannot iterate after awaiting.");
          }
        });
      });
    },
    10000,
  );
});
