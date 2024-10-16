// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import {
  CloseEvent as WSCloseEvent,
  ErrorEvent as WSErrorEvent,
  MessageEvent as WSMessageEvent,
  WebSocket as WS,
} from "ws";
import { ConnectionSettings } from "./interfaces";

export type WebSocket = WS;
export const WebSocket = WS;
export type MessageEvent = WSMessageEvent;
export type CloseEvent = WSCloseEvent;
export type ErrorEvent = WSErrorEvent;

export const sendMessage = (
  socket: WebSocket,
  message: string | ArrayBufferLike | ArrayBufferView,
): Promise<void> => {
  return new Promise((resolve, reject) => {
    socket.send(message, (error?: Error) => {
      if (error) {
        reject(error);
      } else {
        resolve();
      }
    });
  });
};

export async function getWebsocket(
  settings: ConnectionSettings,
): Promise<WebSocket> {
  if (settings.policy != undefined) {
    settings = await settings.policy(settings);
  }
  return new WebSocket(settings.uri, settings.protocols, {
    headers: settings.headers,
  });
}
