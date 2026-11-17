/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

import { emitEvent, hasEventListener } from "../events/index.js";
import { text } from "@noobot/shared/value";
import { MODEL_CONTEXT_TRACE } from "@noobot/model-protocol";
import { resolveRuntimeEventsSessionLogControls } from "@noobot/shared/runtime-events-config";

export function emitModelContextTrace(eventListener, stage, buildPayload) {
  const normalizedStage = text(stage);
  if (!normalizedStage) throw new TypeError("model context trace stage is required");
  if (typeof buildPayload !== "function") {
    throw new TypeError("model context trace requires a payload builder");
  }
  if (!hasEventListener(eventListener)) return;
  if (!resolveRuntimeEventsSessionLogControls().debug.modelContextTrace) return;
  return emitEvent(eventListener, MODEL_CONTEXT_TRACE.EVENT, {
    ...buildPayload(),
    stage: normalizedStage,
  });
}
