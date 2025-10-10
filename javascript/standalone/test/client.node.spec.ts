// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

import { describe, expect, it } from "vitest";
import {
  azureOpenAIDeployment,
  azureOpenAIEndpoint,
  runAzureOpenAILiveTests,
} from "./test-util";
import { LowLevelRTClient } from "../src/client";
import { DefaultAzureCredential } from "@azure/identity";

describe.runIf(runAzureOpenAILiveTests)(
  "LowLevelRTClient (AzureOpenAI w/EntraID)",
  async () => {
    const options = {
      deployment: azureOpenAIDeployment!,
    };

    const client = new LowLevelRTClient(
      new URL(azureOpenAIEndpoint!),
      new DefaultAzureCredential(),
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
