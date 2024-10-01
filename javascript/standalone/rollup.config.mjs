import commonjs from "@rollup/plugin-commonjs";
import dts from "rollup-plugin-dts";
import typescript from "@rollup/plugin-typescript";
import nodeResolve from "@rollup/plugin-node-resolve";
import alias from "@rollup/plugin-alias";

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
