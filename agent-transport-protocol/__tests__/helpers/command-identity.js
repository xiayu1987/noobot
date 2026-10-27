/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { ROOT_PARENT_SESSION_ID } from "../../src/index.js";

export const ROOT_CHANNEL_IDENTITY = Object.freeze({
  sessionId: "",
  parentSessionId: ROOT_PARENT_SESSION_ID,
});

export const ROOT_TURN_START_IDENTITY = Object.freeze({
  ...ROOT_CHANNEL_IDENTITY,
  turnScopeId: "",
});

export const ROOT_COMMAND_IDENTITY = Object.freeze({
  ...ROOT_TURN_START_IDENTITY,
  dialogProcessId: "",
});

export const INTERACTION_IDENTITY = Object.freeze({
  sessionId: "",
  dialogProcessId: "",
  turnScopeId: "",
});
