// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { isKeyCredential, KeyCredential, TokenCredential } from "./auth";
import {
  ConnectionSettings,
  RTAzureOpenAIOptions,
  RTOpenAIOptions,
} from "./interfaces";

function generateUUID() {
  if (typeof crypto !== "undefined" && crypto.randomUUID) {
    return crypto.randomUUID();
  } else if (
    typeof window !== "undefined" &&
    window.crypto &&
    window.crypto.getRandomValues
  ) {
    const array = new Uint8Array(16);
    window.crypto.getRandomValues(array);
    array[6] = (array[6] & 0x0f) | 0x40; // Version 4
    array[8] = (array[8] & 0x3f) | 0x80; // Variant 10
    return [...array]
      .map(
        (b, i) =>
          (i === 4 || i === 6 || i === 8 || i === 10 ? "-" : "") +
          b.toString(16).padStart(2, "0"),
      )
      .join("");
  } else {
    throw new Error("Crypto API not available");
  }
}

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
  const requestId = options.requestId ?? generateUUID();

  const scopes = ["https://cognitiveservices.azure.com/.default"];

  uri.searchParams.set("api-version", "2024-10-01-preview");
  uri.searchParams.set("x-ms-client-request-id", requestId!);
  uri.searchParams.set("deployment", options.deployment);
  uri.pathname = "openai/realtime";
  return {
    uri,
    headers: undefined,
    policy: async (settings) => {
      if (isKeyCredential(credential)) {
        settings.uri.searchParams.set("api-key", credential.key);
      } else {
        const token = await credential.getToken(scopes);
        settings.uri.searchParams.set("Authorization", `Bearer ${token.token}`);
      }
      return settings;
    },
    requestId: requestId,
  };
}
