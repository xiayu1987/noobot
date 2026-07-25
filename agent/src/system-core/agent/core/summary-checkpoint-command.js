/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

import { emitEvent } from "../../event/index.js";
import { consumeMainFlowSummaryCheckpoint } from "./main-flow-control.js";

export async function consumeSummaryCheckpointCommand({
  runtime = null,
  loopState = null,
  eventListener = null,
  turn = 0,
} = {}) {
  const instruction = consumeMainFlowSummaryCheckpoint(runtime);
  if (!instruction) return null;
  try {
    const result = await runtime?.commitSummaryCheckpoint?.({
      summaryCompletion: instruction,
    });
    if (result?.committed === true && loopState && typeof loopState === "object") {
      loopState.turnMessages = runtime?.currentTurnMessages?.toArray?.() || loopState.turnMessages;
    }
    return result;
  } catch (error) {
    emitEvent(eventListener, "summary_checkpoint_failed", {
      turn,
      source: instruction.source,
      message: error?.message || String(error),
    });
    return null;
  }
}
