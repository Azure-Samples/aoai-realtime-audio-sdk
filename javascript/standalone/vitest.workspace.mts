import { defineWorkspace } from "vitest/config";

export default defineWorkspace([
  {
    test: {
      name: "browser",
      include: ["**/*.{spec,browser.spec}.ts"],
      exclude: ["**/*.node.spec.ts"],
      environment: "playwright",
      alias: { "./websocket": "./websocket-browser" },
      browser: {
        screenshotFailures: false,
        enabled: true,
        name: "chromium",
        provider: "playwright",
        headless: true,
      },
    },
  },
  {
    test: {
      name: "node",
      include: ["**/*.{spec,node.spec}.ts"],
      exclude: ["**/*.browser.spec.ts"],
      environment: "node",
    },
  },
]);
