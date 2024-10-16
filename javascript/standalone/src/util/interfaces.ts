// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

export type WebSocketPolicy = (
  ConnectionSettings: ConnectionSettings,
) => Promise<ConnectionSettings>;

export interface ConnectionSettings {
  uri: URL;
  protocols?: string[];
  headers?: Record<string, string>;
  policy?: WebSocketPolicy;
  requestId?: string;
}

export interface RTOpenAIOptions {
  model: string;
}

export interface RTAzureOpenAIOptions {
  deployment: string;
  requestId?: string;
}

export const isRTOpenAIOptions = (
  options: unknown,
): options is RTOpenAIOptions => {
  return (
    typeof options === "object" &&
    options !== null &&
    "model" in options &&
    typeof (options as RTOpenAIOptions).model === "string"
  );
};

export const isRTAzureOpenAIOptions = (
  options: unknown,
): options is RTAzureOpenAIOptions => {
  return (
    typeof options === "object" &&
    options !== null &&
    "deployment" in options &&
    typeof (options as RTAzureOpenAIOptions).deployment === "string"
  );
};
