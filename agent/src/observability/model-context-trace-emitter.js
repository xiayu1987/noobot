/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

import { emitEvent } from "../events/index.js";

export function emitModelContextTrace(runtimeOrListener = null, stage = "", payload = {}) {
  const runtime = runtimeOrListener && typeof runtimeOrListener === "object" && !runtimeOrListener.onEvent
    ? runtimeOrListener
    : {};
  const listener = runtime?.eventListener || (runtimeOrListener?.onEvent ? runtimeOrListener : null);
  emitEvent(listener, "model_context_trace", {
    stage: String(stage || "unknown").trim() || "unknown",
    ...payload,
  });
  return true;
}
