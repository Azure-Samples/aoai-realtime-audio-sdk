// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

export function getRandomValues(array: Uint8Array): Uint8Array {
  if (typeof crypto !== "undefined" && crypto.getRandomValues) {
    return crypto.getRandomValues(array);
  } else if (
    typeof window !== "undefined" &&
    window.crypto &&
    window.crypto.getRandomValues
  ) {
    return window.crypto.getRandomValues(array);
  } else {
    throw new Error("No secure random number generator available.");
  }
}

export function generateId(prefix: string, length: number): string {
  const array = new Uint8Array(length);
  getRandomValues(array);
  const base64 = btoa(String.fromCharCode(...array))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=/g, "");

  return `${prefix}-${base64}`.slice(0, length);
}
