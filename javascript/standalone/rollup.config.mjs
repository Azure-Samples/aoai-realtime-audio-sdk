// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

import commonjs from "@rollup/plugin-commonjs";
import dts from "rollup-plugin-dts";
import typescript from "@rollup/plugin-typescript";
import nodeResolve from "@rollup/plugin-node-resolve";
import alias from "@rollup/plugin-alias";
import replace from "@rollup/plugin-replace";

import pkg from "./package.json" assert { type: "json" };

export default [
  {
    input: "src/index.ts",
    output: [
      {
        file: "dist/cjs/index.js",
        format: "cjs",
        sourcemap: true,
      },
      {
        file: "dist/esm/index.js",
        format: "esm",
        sourcemap: true,
      },
    ],
    plugins: [
      replace({
        values: {
          PACKAGE_VERSION: pkg.version,
        },
        preventAssignment: true,
      }),
      nodeResolve({
        preferBuiltins: true,
      }),
      commonjs(),
      typescript({
        downlevelIteration: true,
        exclude: ["**/*.spec.ts", "**/*.test.ts"],
      }),
    ],
  },
  {
    input: "src/index.ts",
    output: [
      {
        file: "dist/browser/index.js",
        format: "esm",
        sourcemap: true,
      },
      {
        file: "dist/iife/index.js",
        format: "iife",
        name: "rtclient",
        sourcemap: true,
      },
    ],
    plugins: [
      alias({
        entries: [
          {
            find: "./websocket",
            replacement: "./websocket-browser",
          },
          {
            find: "./util/connection-settings",
            replacement: "./util/connection-settings-browser",
          }
        ],
      }),
      typescript({
        downlevelIteration: true,
        exclude: ["**/*.spec.ts", "**/*.test.ts"],
      }),
      nodeResolve({
        browser: true,
        preferBuiltins: true,
      }),
    ],
  },
  {
    input: "src/index.ts",
    output: [
      {
        file: "dist/index.d.ts",
        format: "es",
        sourcemap: true,
      },
    ],
    plugins: [dts()],
  },
];
