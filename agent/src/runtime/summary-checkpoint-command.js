/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

import { emitEvent } from "../events/index.js";
import {
  acknowledgeMainFlowSummaryCheckpoint,
  peekMainFlowSummaryCheckpoint,
} from "./main-flow-control.js";

export async function consumeSummaryCheckpointCommand({
  runtime = null,
  loopState = null,
  eventListener = null,
  turn = 0,
} = {}) {
  const instruction = peekMainFlowSummaryCheckpoint(runtime);
  if (!instruction) return null;
  try {
    const result = await runtime?.commitSummaryCheckpoint?.({
      summaryCompletion: instruction,
    });
    if (result?.committed === true && loopState && typeof loopState === "object") {
      loopState.turnMessages = runtime?.currentTurnMessages?.toArray?.() || loopState.turnMessages;
    }
    if (result?.committed !== true) {
      throw new Error("summary checkpoint was not committed");
    }
    acknowledgeMainFlowSummaryCheckpoint(runtime);
    return result;
  } catch (error) {
    emitEvent(eventListener, "summary_checkpoint_failed", {
      turn,
      source: instruction.source,
      message: error?.message || String(error),
      requestedMessageIds: Array.isArray(error?.requestedMessageIds)
        ? error.requestedMessageIds
        : instruction.summarizedMessageIds,
      resolvedMessageIds: Array.isArray(error?.resolvedMessageIds)
        ? error.resolvedMessageIds
        : [],
      unresolvedMessageIds: Array.isArray(error?.unresolvedMessageIds)
        ? error.unresolvedMessageIds
        : [],
    });
    throw error;
  }
}
