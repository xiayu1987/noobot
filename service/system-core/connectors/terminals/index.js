/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { executeSshCommand } from "./ssh-connector-channel.js";
import { closeSshChannel } from "./ssh-connector-channel.js";

function normalizeTerminalType(connectionInfo = {}) {
  const raw = String(connectionInfo?.terminal_type || "")
    .trim()
    .toLowerCase();
  if (["ssh", "linux_ssh", "server_ssh"].includes(raw)) return "ssh";
  return "";
}

export async function executeTerminalCommand({
  command = "",
  connectionInfo = {},
  channelKey = "",
  sessionId = "",
  connectorName = "",
} = {}) {
  const terminalType = normalizeTerminalType(connectionInfo);
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
  const terminalType = normalizeTerminalType(connectionInfo);
  if (terminalType === "ssh") {
    return closeSshChannel({
      channelKey,
      sessionId,
      connectorName,
    });
  }
  return false;
}
