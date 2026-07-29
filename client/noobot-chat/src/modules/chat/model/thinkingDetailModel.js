/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { deduplicateToolLogs } from "./toolLogIdentity.js";
import { selectToolTimelineLogs } from "../runtime/engine/toolTimeline.js";

export function normalizeThinkingToolLogs({
  messageItem = {},
} = {}) {
  return deduplicateToolLogs(selectToolTimelineLogs(messageItem));
}
