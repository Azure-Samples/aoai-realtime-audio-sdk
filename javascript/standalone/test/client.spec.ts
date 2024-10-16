// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

import { describe, expect, it, test } from "vitest";
import { LowLevelRTClient } from "../src/client";
import {
  azureOpenAIDeployment,
  azureOpenAIEndpoint,
  azureOpenAIKey,
  openAIKey,
  openAIModel,
  runAzureOpenAILiveTests,
  runOpenAILiveTests,
} from "./test-util";
import { RTAzureOpenAIOptions } from "../src/util/interfaces";
import { isKeyCredential } from "../src/util/auth";

describe.runIf(runOpenAILiveTests())(
  "LowLevelRTClient (OpenAI)",
  async () => {
    const client = new LowLevelRTClient(
      { key: openAIKey! },
      { model: openAIModel! },
    );
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

describe.runIf(runAzureOpenAILiveTests())(
  "LowLevelRTClient (AzureOpenAI)",
  async () => {
    const credential = { key: azureOpenAIKey! };
    const options = {
      deployment: azureOpenAIDeployment!,
    };
    expect(
      typeof options === "object" &&
        options !== null &&
        "deployment" in options &&
        typeof (options as RTAzureOpenAIOptions).deployment === "string",
    );
    expect(isKeyCredential(credential));
    const client = new LowLevelRTClient(
      new URL(azureOpenAIEndpoint!),
      credential,
      options,
    );
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
