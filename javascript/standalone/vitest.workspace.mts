import { defineWorkspace } from "vitest/config";

import dotenv from "dotenv";

dotenv.config();

const environmentVariables = {
  LIVE_TESTS: process.env.LIVE_TESTS,
  AZURE_OPENAI_ENDPOINT: process.env.AZURE_OPENAI_ENDPOINT,
  AZURE_OPENAI_API_KEY: process.env.AZURE_OPENAI_API_KEY,
  AZURE_OPENAI_DEPLOYMENT: process.env.AZURE_OPENAI_DEPLOYMENT,
  OPENAI_API_KEY: process.env.OPENAI_API_KEY,
  OPENAI_MODEL: process.env.OPENAI_MODEL,
  PROJECT_DIR: __dirname,
};

export default defineWorkspace([
  {
    test: {
      name: "browser",
      include: ["**/*.{spec,browser.spec}.ts"],
      exclude: ["**/*.node.spec.ts"],
      environment: "playwright",
      alias: {
        "./websocket": "./websocket-browser",
        "./util/connection-settings": "./util/connection-settings-browser",
        "./file-utils": "./file-utils-browser",
      },
      browser: {
        screenshotFailures: false,
        enabled: true,
        name: "chromium",
        provider: "playwright",
        headless: true,
      },
      env: environmentVariables,
    },
  },
  {
    test: {
      name: "node",
      pool: "forks",
      include: ["**/*.{spec,node.spec}.ts"],
      exclude: ["**/*.browser.spec.ts"],
      environment: "node",
      env: environmentVariables,
    },
  },
]);
