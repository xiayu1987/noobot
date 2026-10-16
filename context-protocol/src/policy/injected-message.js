/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

import { readContextMessageField } from "../message/codec.js";
import { CONTEXT_CONTROL_MESSAGE_TYPES } from "../message/injected-types.js";
import { text } from "@noobot/shared/value";

export {
  CONTEXT_INJECTED_MESSAGE_TYPE,
  CONTEXT_CONTROL_MESSAGE_TYPES,
  SUMMARY_ALWAYS_RETAINED_INJECTED_MESSAGE_TYPES,
} from "../message/injected-types.js";

const contextControlTypes = new Set(CONTEXT_CONTROL_MESSAGE_TYPES);

export function resolveContextInternalMessageType(message = {}) {
  return text(readContextMessageField(message, "noobotInternalMessageType"));
}

export function isContextControlMessage(message = {}) {
  return contextControlTypes.has(resolveContextInternalMessageType(message));
}
