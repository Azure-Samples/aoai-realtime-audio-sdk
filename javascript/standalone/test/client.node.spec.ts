// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

import { test } from "vitest";
import fs from "fs/promises";
import { LowLevelRTClient } from "../src/client";
import { DefaultAzureCredential } from "@azure/identity";
import 'dotenv/config'

const runLiveTests = process.env.LIVE_TESTS === "true";
const openAIKey = process.env.OPENAI_API_KEY;
const openAIModel = process.env.OPENAI_MODEL;
const runOpenAILiveTests = runLiveTests && openAIKey && openAIModel;

const azureOpenAIKey = process.env.AZURE_OPENAI_API_KEY;
const azureOpenAIEndpoint = process.env.AZURE_OPENAI_ENDPOINT;
const azureOpenAIDeployment = process.env.AZURE_OPENAI_DEPLOYMENT;
const runAzureOpenAILiveTests =
  runLiveTests &&
  azureOpenAIKey &&
  azureOpenAIEndpoint &&
  azureOpenAIDeployment;

async function* readInputFile(filename: string): AsyncIterable<Uint8Array> {
  const file = await fs.open(filename, "r");

  while (true) {
    const buffer = new Uint8Array(4096);
    const { bytesRead } = await file.read(buffer);
    yield buffer.slice(0, bytesRead);
    if (bytesRead < buffer.length) {
      break;
    }
  }
}

test.runIf(runOpenAILiveTests).skip(
  "LowLevelRTClient (OpenAI)",
  async () => {
    const client = new LowLevelRTClient(
      { key: openAIKey! },
      { model: openAIModel! },
    );
    const sendTask = async () => {
      await client.send({
        type: "session.update",
        session: {
          turn_detection: {
            type: "server_vad",
          },
        },
      });
      for await (const chunk of readInputFile(
        "test/input/arc-easy-q237-tts.raw",
      )) {
        const base64Encoded = Buffer.from(chunk).toString("base64");
        await client.send({
          type: "input_audio_buffer.append",
          audio: base64Encoded,
        });
      }
    };
    const receiveTask = async () => {
      for await (const message of client.messages()) {
        if (message.type === "response.done") {
          break;
        }
      }
      await client.close();
    };
    await Promise.all([sendTask(), receiveTask()]);
  },
  60000,
);

test.runIf(runAzureOpenAILiveTests)(
  "LowLevelRTClient (Azure OpenAI)",
  async () => {
    const client = new LowLevelRTClient(
      new URL(azureOpenAIEndpoint!),
      {
        key: azureOpenAIKey!,
      },
      {
        deployment: azureOpenAIDeployment!,
      },
    );
    const sendTask = async () => {
      try {
        await client.send({
          type: "session.update",
          session: {
            turn_detection: {
              type: "server_vad",
            },
          },
        });
        for await (const chunk of readInputFile(
          "test/input/arc-easy-q237-tts.raw",
        )) {
          const base64Encoded = Buffer.from(chunk).toString("base64");
          await client.send({
            type: "input_audio_buffer.append",
            audio: base64Encoded,
          });
        }
      } catch (e) {
        console.log(e);
      }
    };
    const receiveTask = async () => {
      for await (const message of client.messages()) {
        if (message.type === "response.done") {
          break;
        }
      }
      await client.close();
    };
    await Promise.all([sendTask(), receiveTask()]);
  },
  60000,
);

test.runIf(runAzureOpenAILiveTests)(
  "LowLevelRTClient (Azure OpenAI w/EntraID)",
  async () => {
    const client = new LowLevelRTClient(
      new URL(azureOpenAIEndpoint!),
      new DefaultAzureCredential(),
      {
        deployment: azureOpenAIDeployment!,
      },
    );
    const sendTask = async () => {
      try {
        await client.send({
          type: "session.update",
          session: {
            turn_detection: {
              type: "server_vad",
            },
          },
        });
        for await (const chunk of readInputFile(
          "test/input/arc-easy-q237-tts.raw",
        )) {
          const base64Encoded = Buffer.from(chunk).toString("base64");
          await client.send({
            type: "input_audio_buffer.append",
            audio: base64Encoded,
          });
        }
      } catch (e) {
        console.log(e);
      }
    };
    const receiveTask = async () => {
      for await (const message of client.messages()) {
        if (message.type === "response.done") {
          break;
        }
      }
      await client.close();
    };
    await Promise.all([sendTask(), receiveTask()]);
  },
  60000,
);

/*
test.runIf(runOpenAILiveTests)("RTClient (OpenAI)", async () => {
  const client = new RTClient(openAIKey!);
  await client.configure({
    turn_detection: "server_vad",
    input_audio_format: "pcm16",
    transcribe_input: true,
  });

  const defaultConversation = client.getDefaultConversation();

  await defaultConversation.configure({
    system_message:
      "You are a helpful assistant. You respond with information obtained from the functions provided.",
    voice: "alloy",
    tools: [
      {
        type: "function",
        function: {
          description: "Get weather for a location",
          name: "get_weather",
          strict: true,
          parameters: {
            type: "object",
            properties: {
              location: {
                type: "string",
              },
              unit: {
                type: "string",
                enum: ["c", "f"],
              },
            },
            required: ["location", "unit"],
            additionalProperties: false,
          },
        },
      },
      {
        type: "function",
        function: {
          description: "Get the user's location",
          name: "get_location",
          strict: true,
          parameters: {},
        },
      },
    ],
    tool_choice: "required",
    temperature: 0.6,
  });

  const handleMessage = async (message: RTMessage): Promise<void> => {
    const contentAccumulator = message.content.map((_) => "");
    for await (const chunk of message) {
      expect(chunk.index < contentAccumulator.length).toBe(true);
      const content = message.content[chunk.index];
      expect(chunk.type, content.type);
      contentAccumulator[chunk.index] += chunk.data;
      switch (content.type) {
        case "audio":
          expect(contentAccumulator[chunk.index], content.audio);
          break;
        case "text":
          expect(contentAccumulator[chunk.index], content.text);
          break;
        case "tool_call":
          expect(contentAccumulator[chunk.index], content.arguments);
      }
    }
  };

  const sendTask = async () => {
    for await (const chunk of readInputFile(
      "test/input/tell_me_the_weather.raw",
    )) {
      await client.sendAudio(chunk);
    }
  };

  const messageTasks: Promise<void>[] = [];
  const receiveTask = async () => {
    for await (const message of defaultConversation) {
      const messageTask = handleMessage(message);
      messageTasks.push(messageTask);
    }
  };
  const controlTask = async () => {
    for await (const _ of defaultConversation.controlMessages()) {
      break;
    }
    client.close();
  };
  await Promise.all([sendTask(), receiveTask(), controlTask()]);
  await Promise.all(messageTasks);
});

test.runIf(runAzureOpenAILiveTests)("RTClient (AzureOpenAI)", async () => {
  const client = new RTClient(new URL(azureOpenAIEndpoint!), azureOpenAIKey!);
  await client.configure({
    turn_detection: "server_vad",
    input_audio_format: "pcm16",
    transcribe_input: true,
  });

  const defaultConversation = client.getDefaultConversation();

  await defaultConversation.configure({
    system_message:
      "You are a helpful assistant. You respond with information obtained from the functions provided.",
    voice: "alloy",
    tools: [
      {
        type: "function",
        function: {
          description: "Get weather for a location",
          name: "get_weather",
          strict: true,
          parameters: {
            type: "object",
            properties: {
              location: {
                type: "string",
              },
              unit: {
                type: "string",
                enum: ["c", "f"],
              },
            },
            required: ["location", "unit"],
            additionalProperties: false,
          },
        },
      },
      {
        type: "function",
        function: {
          description: "Get the user's location",
          name: "get_location",
          strict: true,
          parameters: {},
        },
      },
    ],
    tool_choice: "required",
    temperature: 0.6,
  });

  const handleMessage = async (message: RTMessage): Promise<void> => {
    const contentAccumulator = message.content.map((_) => "");
    for await (const chunk of message) {
      expect(chunk.index < contentAccumulator.length).toBe(true);
      const content = message.content[chunk.index];
      expect(chunk.type, content.type);
      contentAccumulator[chunk.index] += chunk.data;
      switch (content.type) {
        case "audio":
          expect(contentAccumulator[chunk.index], content.audio);
          break;
        case "text":
          expect(contentAccumulator[chunk.index], content.text);
          break;
        case "tool_call":
          expect(contentAccumulator[chunk.index], content.arguments);
      }
    }
  };

  const sendTask = async () => {
    for await (const chunk of readInputFile(
      "test/input/tell_me_the_weather.raw",
    )) {
      await client.sendAudio(chunk);
    }
  };

  const messageTasks: Promise<void>[] = [];
  const receiveTask = async () => {
    for await (const message of defaultConversation) {
      const messageTask = handleMessage(message);
      messageTasks.push(messageTask);
    }
  };
  const controlTask = async () => {
    for await (const controlMessage of defaultConversation.controlMessages()) {
      console.log(controlMessage);
      break;
    }
    client.close();
  };
  await Promise.all([sendTask(), receiveTask(), controlTask()]);
  await Promise.all(messageTasks);
});
*/
