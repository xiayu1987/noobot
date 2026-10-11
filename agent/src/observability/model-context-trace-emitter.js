/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

import { emitEvent } from "../events/index.js";

export function emitModelContextTrace(eventListener, stage, payload) {
  const normalizedStage = String(stage || "").trim();
  if (!normalizedStage) throw new TypeError("model context trace stage is required");
  emitEvent(eventListener, "model_context_trace", { ...payload, stage: normalizedStage });
}
