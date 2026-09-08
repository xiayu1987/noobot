/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

import { readMessageField } from "./message.js";

export {
  CONTEXT_INJECTED_MESSAGE_TYPE,
  SUMMARY_CHECKPOINT_CONTROL_MESSAGE_TYPES,
} from "../message/injected-types.js";

export function resolveContextInternalMessageType(message = {}) {
  return String(readMessageField(message, "noobotInternalMessageType") || "").trim();
}
