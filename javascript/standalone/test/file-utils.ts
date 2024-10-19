// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

import fs from "fs/promises";

export async function* readInputFile(
  filename: string,
  chunkSize: number = 4096,
): AsyncIterable<Uint8Array> {
  const file = await fs.open(filename, "r");
  while (true) {
    const buffer = new Uint8Array(chunkSize);
    const { bytesRead } = await file.read(buffer);
    if (bytesRead === 0) {
      break;
    }
    yield buffer.slice(0, bytesRead);
    if (bytesRead < buffer.length) {
      break;
    }
  }
}

export function testFilePath(filename: string): string {
  return `${process.env.PROJECT_DIR || ""}/test/input/${filename}`;
}
