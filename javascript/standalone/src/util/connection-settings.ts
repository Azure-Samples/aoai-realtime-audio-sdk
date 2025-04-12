// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { isKeyCredential, KeyCredential, TokenCredential } from "./auth";
import {
  ConnectionSettings,
  RTAzureOpenAIOptions,
  RTOpenAIOptions,
  RTVoiceAgentOptions,
} from "./interfaces";

function getUserAgent() {
  return `ms-rtclient/PACKAGE_VERSION`;
}

export function openAISettings(
  credential: KeyCredential,
  options: RTOpenAIOptions,
): ConnectionSettings {
  const uri = new URL("wss://api.openai.com/v1/realtime");
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

  uri.searchParams.set("api-version", options.apiVersion ?? "2024-10-01-preview");
  uri.searchParams.set("deployment", options.deployment);
  uri.pathname = options.path ?? "openai/realtime";
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


export function voiceAgentSettings(
  uri: URL,
  credential: KeyCredential | TokenCredential,
  options: RTVoiceAgentOptions,
): ConnectionSettings {
  const requestId = options.requestId ?? crypto.randomUUID();

  const scopes = ["https://cognitiveservices.azure.com/.default"];

  uri.searchParams.set("api-version", options.apiVersion ?? "2025-05-01-preview");
  uri.searchParams.set("x-ms-client-request-id", requestId!);
  if (typeof options.modelOrAgent === "string") {
    uri.searchParams.set("model", options.modelOrAgent);
  } else {
    uri.searchParams.set("agent_id", options.modelOrAgent.agentId);
    uri.searchParams.set(
      "agent_connection_string",
      options.modelOrAgent.agentConnectionString,
    );
    if (options.modelOrAgent.agentAuthenticationIdentityClientId) {
      uri.searchParams.set(
        "agent_authentication_identity_client_id",
        options.modelOrAgent.agentAuthenticationIdentityClientId,
      );
    }
    if (options.modelOrAgent.agentAccessToken) {
      uri.searchParams.set(
        "agent_access_token",
        options.modelOrAgent.agentAccessToken,
      );
    }
    if (options.modelOrAgent.threadId) {
      uri.searchParams.set("agent_thread_id", options.modelOrAgent.threadId);
    }
  }
  uri.pathname = options.path ?? "voice-agent/realtime";
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