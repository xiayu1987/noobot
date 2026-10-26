/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

import { buildNoFinalResponseRetryPolicy, isNoFinalResponseError } from "@noobot/model-protocol";
import { CONTEXT_INJECTED_MESSAGE_TYPE } from "@noobot/context-protocol/policy/injected-message";
import {
  NO_FINAL_RESPONSE_RETRY_POLICY,
  hasNoFinalResponseRetryBudget,
  resolveNextNoFinalResponseRetryOrdinal,
} from "@noobot/context-protocol/policy/no-final-response-retry";
import { emitEvent } from "../../events/index.js";
import { tEngine } from "../i18n-adapter.js";
import { appendTurnContextControlMessage } from "./turn-context-message-appender.js";
import { getSystemRuntimeFromRuntime } from "../../context/agent-context-accessor.js";
import { isObjectLike } from "@noobot/shared/value";

export const MAIN_FLOW_NO_FINAL_RESPONSE_RETRY = buildNoFinalResponseRetryPolicy(
  Object.freeze({ maxAttempts: NO_FINAL_RESPONSE_RETRY_POLICY.IN_PLACE_RETRY_ATTEMPTS }),
);

function readCounter(runtime, key) {
  return Number(getSystemRuntimeFromRuntime(runtime)[key] || 0);
}

export function isRecoverableNoFinalResponse(error, runtime = {}) {
  return (
    isNoFinalResponseError(error) &&
    hasNoFinalResponseRetryBudget(readCounter(runtime, "noFinalResponseRetryConsecutiveCount"))
  );
}

export function resetNoFinalResponseRetryStreak(runtime = {}) {
  const systemRuntime = runtime?.systemRuntime;
  if (isObjectLike(systemRuntime)) {
    systemRuntime.noFinalResponseRetryConsecutiveCount = 0;
  }
}

export function recoverMainFlowNoFinalResponse({ error, modelState, turn }) {
  const { runtime } = modelState;
  const { eventListener } = runtime;
  if (!isRecoverableNoFinalResponse(error, runtime)) return false;
  const systemRuntime = runtime?.systemRuntime;
  if (!isObjectLike(systemRuntime)) {
    throw new Error("Empty response retry requires the dialog turn systemRuntime");
  }
  const ordinal = resolveNextNoFinalResponseRetryOrdinal(
    readCounter(runtime, "noFinalResponseRetryPromptCount"),
  );
  const consecutive = readCounter(runtime, "noFinalResponseRetryConsecutiveCount") + 1;
  appendTurnContextControlMessage({
    runtime,
    content: tEngine(runtime, "noFinalResponseRetryPrompt", { ordinal }),
    internalType: CONTEXT_INJECTED_MESSAGE_TYPE.NO_FINAL_RESPONSE_RETRY_PROMPT,
  });
  systemRuntime.noFinalResponseRetryPromptCount = ordinal;
  systemRuntime.noFinalResponseRetryConsecutiveCount = consecutive;
  emitEvent(eventListener, "no_final_response_retry_prompted", {
    turn,
    ordinal,
    consecutive,
    maxConsecutivePrompts: NO_FINAL_RESPONSE_RETRY_POLICY.MAX_CONSECUTIVE_PROMPTS,
    attemptCount: Number(error?.details?.attemptCount || 0),
  });
  return true;
}
