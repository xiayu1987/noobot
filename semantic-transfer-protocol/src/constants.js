/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

export const TRANSFER_PROTOCOL = "noobot.semantic-transfer";
export const TRANSFER_VERSION = 2;
export const TRANSFER_DIRECTION = Object.freeze({
  INPUT: "input",
  OUTPUT: "output",
});
export const TRANSFER_MODE = Object.freeze({
  DIRECT: "direct",
  ATTACHMENT: "attachment",
  SOURCE_REFERENCE: "source_reference",
});
export const TRANSFER_SOURCE = Object.freeze({
  USER: "user",
  SYSTEM: "system",
  AGENT: "agent",
  SUBAGENT: "subagent",
  MODEL: "model",
  TOOL: "tool",
  PLUGIN: "plugin",
  SERVICE: "service",
  CONNECTOR: "connector",
});
