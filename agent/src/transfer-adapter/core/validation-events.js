/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { emitEvent } from "../../events/index.js";
import { runAgentRuntimeHook } from "../../extensions/hooks/index.js";
import { HOOK_PHASE_STATUS, HOOK_POINT } from "@noobot/hook-protocol";

export async function emitSemanticTransferValidation({ runtime, scenario, transferEnvelopes }) {
  const payload = { scenario, envelopeCount: transferEnvelopes.length };
  emitEvent(runtime.eventListener, "semantic_transfer_validation", payload);
  await runAgentRuntimeHook({
    runtime,
    point: HOOK_POINT.AGENT.SEMANTIC_TRANSFER_VALIDATION,
    context: {
      phase: "semantic_transfer",
      status: HOOK_PHASE_STATUS.SUCCESS,
      ...payload,
    },
  });
  return payload;
}
