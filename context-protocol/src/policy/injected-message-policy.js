/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

import { readMessageField } from "./message-policy.js";

export { CONTEXT_INJECTED_MESSAGE_TYPE } from "./injected-message-types.js";

export function resolveContextInternalMessageType(message = {}) {
  return String(readMessageField(message, "noobotInternalMessageType") || "").trim();
}
