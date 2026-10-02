/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

import { readMessageField } from "./message.js";
import { CONTEXT_CONTROL_MESSAGE_TYPES } from "../message/injected-types.js";

export {
  CONTEXT_INJECTED_MESSAGE_TYPE,
  CONTEXT_CONTROL_MESSAGE_TYPES,
  SUMMARY_ALWAYS_RETAINED_INJECTED_MESSAGE_TYPES,
} from "../message/injected-types.js";

const contextControlTypes = new Set(CONTEXT_CONTROL_MESSAGE_TYPES);

export function resolveContextInternalMessageType(message = {}) {
  return String(readMessageField(message, "noobotInternalMessageType") || "").trim();
}

export function isContextControlMessage(message = {}) {
  return contextControlTypes.has(resolveContextInternalMessageType(message));
}
