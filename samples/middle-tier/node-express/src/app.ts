// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import express from "express";
import { WebSocketServer } from "ws";
import http from "http";
import { config } from "dotenv";
import { pino } from "pino";
import { RTSession } from "./session.js";

config();

const logger = pino({
  level: process.env.LOG_LEVEL || "info",
  transport: {
    target: "pino-pretty",
    options: {
      colorize: true,
    },
  },
});

const app = express();
const server = http.createServer(app);
const wss = new WebSocketServer({ noServer: true });

server.on("upgrade", (request, socket, head) => {
  const { pathname } = new URL(request.url!, `http://${request.headers.host}`);
  if (pathname === "/realtime") {
    logger.debug({ pathname }, "Handling WebSocket upgrade request");
    wss.handleUpgrade(request, socket, head, (ws) => {
      logger.debug("WebSocket upgrade successful");
      wss.emit("connection", ws, request);
    });
  } else {
    logger.warn({ pathname }, "Invalid WebSocket path - destroying connection");
    socket.destroy();
  }
});

wss.on("connection", (ws) => {
  logger.info("New WebSocket connection established");
  new RTSession(ws, process.env.BACKEND, logger);
});

const PORT = process.env.PORT || 8080;

server.listen(PORT, () => {
  logger.info(`Server started on http://localhost:${PORT}`);
});
