/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

export const DSL_PROTOCOL = Object.freeze({
  HEADER: "WORKFLOW_DSL/1",
  LEGACY_HEADER_KEYWORD: "WORKFLOW",
  LEGACY_HEADER_VERSION: "1",
  CMD_NODE: "NODE",
  CMD_ATTACHMENT: "ATTACHMENT",
  CMD_EDGE: "EDGE",
  CMD_AUTO: "AUTO",
  CMD_END: "END",
});

export const DSL_DEFAULTS = Object.freeze({
  START_NODE_ID: "start",
  END_NODE_ID: "end",
  STATE_TYPE_START: 0,
  STATE_TYPE_END: 1,
});

export const DSL_TYPES = Object.freeze({
  NODE_STATE: "state",
  NODE_ACTION: "action",
  NODE_COMPOSITE: "composite",
  AUTO_SUBMIT: "submit",
  AUTO_AUDIT: "audit",
  AUTO_BACK: "back",
  AUTO_STOP: "stop",
});
