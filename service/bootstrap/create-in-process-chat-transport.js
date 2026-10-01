/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { EventEmitter } from "node:events";
import {
  CONNECTION_CLOSE_POLICY,
  createChatConnectionHandler,
} from "../ws/chat-websocket/connection-handler.js";
import { AUTHORITY_EVENT_CONSUMER } from "../ws/chat-websocket/authority-event-dispatcher.js";

const SOCKET_OPEN = 1;
const SOCKET_CLOSED = 3;

export const IN_PROCESS_EXIT_CODE = Object.freeze({
  done: 0,
  user_stopped: 130,
  timeout: 1,
  aborted: 1,
  error: 1,
  "invalid request": 2,
});

export function resolveInProcessExitCode(reason = "") {
  const key = String(reason || "").trim();
  return Object.prototype.hasOwnProperty.call(IN_PROCESS_EXIT_CODE, key)
    ? IN_PROCESS_EXIT_CODE[key]
    : 1;
}

function decodePacket(packet) {
  try {
    const parsed = JSON.parse(String(packet));
    return parsed && typeof parsed === "object" ? parsed : null;
  } catch {
    return null;
  }
}

class InProcessSocket extends EventEmitter {
  constructor(onPacket) {
    super();
    this.readyState = SOCKET_OPEN;
    this.onPacket = onPacket;
  }

  send(packet, callback) {
    if (this.readyState !== SOCKET_OPEN) {
      callback?.(new Error("in-process socket closed"));
      return;
    }
    let deliveryError = null;
    try {
      this.onPacket(packet);
    } catch (error) {
      deliveryError = error;
    }
    setImmediate(() => callback?.(deliveryError || undefined));
  }

  close(code = 1000, reason = "") {
    if (this.readyState === SOCKET_CLOSED) return;
    this.readyState = SOCKET_CLOSED;
    this.emit("close", code, Buffer.from(String(reason || ""), "utf8"));
  }
}

export function createInProcessChatTransport({
  appDependencies,
  connectorAccessPort,
  sessionLogConfig,
} = {}) {
  const handleConnection = createChatConnectionHandler({
    consumerId: AUTHORITY_EVENT_CONSUMER.CLI,
    closePolicy: CONNECTION_CLOSE_POLICY.ABORT_RUN,
    resolveBot: appDependencies.getBot,
    normalizeLocale: appDependencies.normalizeLocale,
    defaultLocale: appDependencies.defaultLocale,
    translateText: appDependencies.translateText,
    mapAgentRunCommand: appDependencies.mapAgentRunCommand,
    connectorAccessPort,
    sessionLogConfig,
  });

  function openConnection({ authInfo, locale = "", onEvent = () => {} } = {}) {
    if (!String(authInfo?.userId || "").trim()) {
      throw new TypeError("in-process connection requires authInfo.userId");
    }
    const socket = new InProcessSocket((packet) => {
      const decoded = decodePacket(packet);
      if (decoded) onEvent(decoded);
    });
    const closed = new Promise((resolve) => {
      socket.once("close", (code, reasonBuffer) => {
        const reason = Buffer.isBuffer(reasonBuffer)
          ? reasonBuffer.toString("utf8")
          : String(reasonBuffer || "");
        resolve({ code, reason, exitCode: resolveInProcessExitCode(reason) });
      });
    });
    handleConnection(socket, { auth: authInfo, locale });
    return {
      closed,
      isOpen: () => socket.readyState === SOCKET_OPEN,
      send(command) {
        if (socket.readyState !== SOCKET_OPEN) throw new Error("in-process connection closed");
        socket.emit("message", Buffer.from(JSON.stringify(command), "utf8"));
      },
      close(reason = "client closed") {
        socket.close(1000, reason);
      },
    };
  }

  return { openConnection };
}
