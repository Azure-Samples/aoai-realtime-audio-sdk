// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { isKeyCredential, KeyCredential, TokenCredential } from "./auth";
import {
  ConnectionSettings,
  RTAzureOpenAIOptions,
  RTOpenAIOptions,
} from "./interfaces";

function getUserAgent() {
  return `ms-rtclient/PACKAGE_VERSION`;
}

export function openAISettings(
  credential: KeyCredential,
  options: RTOpenAIOptions,
): ConnectionSettings {
  const uri = options?.endpoint ?? new URL("wss://api.openai.com/v1/realtime");
  uri.searchParams.set("model", options.model);
  return {
    uri,
    headers: {
      Authorization: `Bearer ${credential.key}`,
      "openai-beta": "realtime=v1",
      "User-Agent": "openai-node",
    },
  };
}

export function azureOpenAISettings(
  uri: URL,
  credential: KeyCredential | TokenCredential,
  options: RTAzureOpenAIOptions,
): ConnectionSettings {
  const requestId = options.requestId ?? crypto.randomUUID();

  const scopes = ["https://cognitiveservices.azure.com/.default"];

  uri.searchParams.set("api-version", "2024-10-01-preview");
  uri.searchParams.set("deployment", options.deployment);
  uri.pathname = "openai/realtime";
  return {
    uri,
    headers: {
      "User-Agent": getUserAgent(),
      "x-ms-client-request-id": requestId,
    },
    policy: async (settings) => {
      if (isKeyCredential(credential)) {
        settings.headers = {
          ...settings.headers,
          "api-key": credential.key,
        };
      } else {
        const token = await credential.getToken(scopes);
        settings.headers = {
          ...settings.headers,
          Authorization: `Bearer ${token.token}`,
          requestId,
        };
      }
      return settings;
    },
  };
}
