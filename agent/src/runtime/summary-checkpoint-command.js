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
import { SESSION_ERROR_CODE } from "@noobot/session-protocol";

export async function consumeSummaryCheckpointCommand({ runtime, eventListener, turn }) {
  const instruction = peekMainFlowSummaryCheckpoint(runtime);
  if (!instruction) return null;
  try {
    const result = await runtime.commitSummaryCheckpoint({
      summaryCompletion: instruction,
    });
    if (result.committed !== true) {
      throw new Error("summary checkpoint was not committed");
    }
    acknowledgeMainFlowSummaryCheckpoint(runtime);
    return result;
  } catch (error) {
    emitEvent(eventListener, "summary_checkpoint_failed", {
      turn,
      source: instruction.source,
      message: error?.message || String(error),
      summarizedMessageUids: instruction.summarizedMessageUids,
      ...(error?.code === SESSION_ERROR_CODE.TURN_SUMMARY_CHECKPOINT_MESSAGE_MISSING
        ? { messageUidResolution: error.messageUidResolution }
        : {}),
    });
    throw error;
  }
}
