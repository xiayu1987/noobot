/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

export const TRANSFER_PROTOCOL = "noobot.semantic-transfer";
export const TRANSFER_VERSION = 1;

export const TRANSFER_DIRECTION = Object.freeze({
  INPUT: "input",
  OUTPUT: "output",
});

export const TRANSFER_TRANSPORT = Object.freeze({
  DIRECT: "direct",
  FILE: "file",
});

export const TRANSFER_SOURCE = Object.freeze({
  USER: "user",
  SYSTEM: "system",
  AGENT: "agent",
  CHILD_AGENT: "subagent",
  MODEL: "model",
  TOOL: "tool",
  CONNECTOR: "connector",
  PLUGIN: "plugin",
  SERVICE: "service",
});

export const TRANSFER_STORAGE_KIND = Object.freeze({
  ATTACHMENT: "attachment",
  WORKSPACE: "workspace",
  TEMP: "temp",
  EXTERNAL: "external",
});

export const DEFAULT_TRANSFER_MIME_TYPE = "text/plain";
