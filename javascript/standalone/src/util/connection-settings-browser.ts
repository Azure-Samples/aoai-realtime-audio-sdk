// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { isKeyCredential, KeyCredential, TokenCredential } from "./auth";
import {
  ConnectionSettings,
  RTAzureOpenAIOptions,
  RTOpenAIOptions,
} from "./interfaces";

export function openAISettings(
  credential: KeyCredential,
  options: RTOpenAIOptions,
): ConnectionSettings {
  const uri = new URL("wss://api.openai.com/v1/realtime");
  uri.searchParams.set("model", options.model);
  return {
    uri,
    protocols: [
      "realtime",
      `openai-insecure-api-key.${credential.key}`,
      "openai-beta.realtime-v1",
    ],
  };
}

export function azureOpenAISettings(
  uri: URL,
  credential: KeyCredential | TokenCredential,
  options: RTAzureOpenAIOptions,
): ConnectionSettings {
  if (this.requestId === undefined) {
    throw new Error("requestId is required");
  }
  const scopes = ["https://cognitiveservices.azure.com/.default"];
  this.requestId = crypto.randomUUID();
  uri.searchParams.set("api-version", "2024-10-01-preview");
  uri.searchParams.set("x-ms-client-request-id", this.requestId!);
  uri.searchParams.set("deployment", options.deployment);
  uri.pathname = "openai/realtime";
  return {
    uri,
    policy: async (settings) => {
      if (isKeyCredential(credential)) {
        settings.uri.searchParams.set("api-key", credential.key);
      } else {
        const token = await credential.getToken(scopes);
        settings.uri.searchParams.set("Authorization", `Bearer ${token.token}`);
      }
      return settings;
    },
  };
}
