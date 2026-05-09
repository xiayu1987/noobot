/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { executeSshCommand, closeSshChannel } from "./ssh-connector-channel.js";
import { normalizeTerminalType } from "../../config/index.js";

export async function executeTerminalCommand({
  command = "",
  connectionInfo = {},
  channelKey = "",
  sessionId = "",
  connectorName = "",
} = {}) {
  const terminalType = normalizeTerminalType(connectionInfo?.terminal_type || "");
  if (terminalType === "ssh") {
    return executeSshCommand({
      command,
      connectionInfo,
      channelKey,
      sessionId,
      connectorName,
    });
  }
  return {
    ok: false,
    code: 400,
    stdout: "",
    stderr: "unknown terminal type, set connection_info.terminal_type as ssh",
  };
}

export function releaseTerminalChannel({
  connectionInfo = {},
  channelKey = "",
  sessionId = "",
  connectorName = "",
} = {}) {
  const terminalType = normalizeTerminalType(connectionInfo?.terminal_type || "");
  if (terminalType === "ssh") {
    return closeSshChannel({
      channelKey,
      sessionId,
      connectorName,
    });
  }
  return false;
}
