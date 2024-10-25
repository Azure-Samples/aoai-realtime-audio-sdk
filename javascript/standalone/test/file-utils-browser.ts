// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

import { server } from "@vitest/browser/context";

const { readFile } = server.commands;

export async function* readInputFile(
  filename: string,
  chunkSize: number = 4096,
): AsyncIterable<Uint8Array> {
  const content = await readFile(filename, { encoding: "base64" });
  const byteString = atob(content);
  let bytes = new Uint8Array(byteString.length);
  for (let i = 0; i < content.length; i++) {
    bytes[i] = content.charCodeAt(i);
  }

  while (bytes.length > 0) {
    const chunk = new Uint8Array(bytes.slice(0, chunkSize));
    yield chunk;
    bytes = bytes.slice(chunkSize);
  }
}

export function testFilePath(filename: string): string {
  return `${process.env.PROJECT_DIR || ""}/test/input/${filename}`;
}
