// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { ConnectionSettings } from "./interfaces";

type _WS = WebSocket;
const _WS = WebSocket;
const _CloseEvent = CloseEvent;
const _ErrorEvent = ErrorEvent;
const _MessageEvent = MessageEvent;
export {
  _WS as WebSocket,
  _MessageEvent as MessageEvent,
  _CloseEvent as CloseEvent,
  _ErrorEvent as ErrorEvent,
};

export const sendMessage = (
  socket: WebSocket,
  message: string | ArrayBufferLike | ArrayBufferView,
): Promise<void> => {
  if (socket.readyState !== WebSocket.OPEN) {
    return Promise.reject(new Error("Socket is not open"));
  }
  socket.send(message);
  return Promise.resolve();
};

export async function getWebsocket(
  settings: ConnectionSettings,
): Promise<WebSocket> {
  if (settings.policy != undefined) {
    settings = await settings.policy(settings);
  }
  if (settings.headers != undefined) {
    throw new Error("Headers are not supported in the browser");
  }
  return new WebSocket(settings.uri, settings.protocols);
}
