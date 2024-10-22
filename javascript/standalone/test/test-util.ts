// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

const runLiveTests = process.env.LIVE_TESTS === "true";
export const openAIKey = process.env.OPENAI_API_KEY;
export const openAIModel = process.env.OPENAI_MODEL;

export const azureOpenAIKey = process.env.AZURE_OPENAI_API_KEY;
export const azureOpenAIEndpoint = process.env.AZURE_OPENAI_ENDPOINT;
export const azureOpenAIDeployment = process.env.AZURE_OPENAI_DEPLOYMENT;

function undefinedOrEmpty(value: string | undefined): boolean {
  return value === undefined || value === "";
}

export const runOpenAILiveTests =
  runLiveTests &&
  !(undefinedOrEmpty(openAIKey) || undefinedOrEmpty(openAIModel));
export const runAzureOpenAILiveTests =
  runLiveTests &&
  !(
    undefinedOrEmpty(azureOpenAIKey) ||
    undefinedOrEmpty(azureOpenAIEndpoint) ||
    undefinedOrEmpty(azureOpenAIDeployment)
  );
