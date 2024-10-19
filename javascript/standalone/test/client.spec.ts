// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

import { afterEach, beforeEach, describe, expect, it, test } from "vitest";
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

        expect(() => client.commitAudio()).rejects.toThrow("buffer is empty");
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
    },
    10000,
  );
});
