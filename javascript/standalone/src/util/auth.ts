// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

export interface KeyCredential {
  key: string;
}

export interface AccessToken {
  token: string;
  expiresOnTimestamp: number;
  refreshAfterTimestamp?: number;
}

export interface TokenCredential {
  getToken(scopes: string | string[], options?: unknown): Promise<AccessToken>;
}

export function isKeyCredential(
  credential: unknown,
): credential is KeyCredential {
  return (
    typeof credential === "object" &&
    credential !== null &&
    "key" in credential &&
    typeof (credential as KeyCredential).key === "string"
  );
}

export function isTokenCredential(
  credential: unknown,
): credential is TokenCredential {
  return (
    typeof credential === "object" &&
    credential !== null &&
    "getToken" in credential &&
    typeof (credential as TokenCredential).getToken === "function"
  );
}

export const isCredential = (
  credential: unknown,
): credential is KeyCredential | TokenCredential =>
  isKeyCredential(credential) || isTokenCredential(credential);
