/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { normalizeToolCalls } from "../../models/invoke/tool-call-normalizer.js";

export function normalizeToolTurnAi(ai = {}) {
  const { rawCalls, calls } = normalizeToolCalls({
    ...ai,
    tool_calls: ai?.toolCalls ?? ai?.tool_calls,
  });
  return {
    rawCalls,
    calls,
    aiContentText: String(ai?.text || ""),
  };
}
