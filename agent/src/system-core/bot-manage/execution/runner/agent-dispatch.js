/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

import { emitEvent } from "../../../event/index.js";
import { isAbortError } from "../../../utils/error-utils.js";
import { BOT_HOOK_POINTS, runBotRuntimeHook } from "../../hook/index.js";
import {
  BOT_DISPATCH_DISPOSITION,
  isBotDispatchOutcome,
  resolveBotDispatchOutcome,
} from "@noobot/shared/bot-dispatch-protocol";

export async function dispatchAgentTurn({
  agentRunner,
  errorLogger,
  lifecycle,
  dispatchRuntime,
  runtimeAgentContext,
  abortSignal,
  normalizedMessage,
  userMessageAttachments,
  resolvedRunConfig,
  runtimeEventListener,
  botHookRuntime,
  botHookBase,
  agentContextSummary,
  usedSessionId,
  dialogProcessId,
  resolvedTurnScopeId,
  syncLifecycleRuntimeState,
}) {
const dispatchContextMessages = Array.isArray(runtimeAgentContext?.payload?.messages?.history)
  ? runtimeAgentContext.payload.messages.history
  : [];

let dispatchClaimed = false;
let dispatchOwner = null;
const claimAgentDispatch = ({
  owner = "",
  source = "agent_dispatch",
  executionId = "",
  executionKind = "agent",
  parentExecutionId = "",
  rootExecutionId = "",
  origin = {},
  stage = "",
} = {}) => {
  if (dispatchClaimed) return false;
  dispatchClaimed = true;
  dispatchOwner = {
    owner: String(owner || "").trim(),
    source: String(source || "agent_dispatch").trim() || "agent_dispatch",
    executionKind: String(executionKind || "agent").trim().toLowerCase() || "agent",
    origin: origin && typeof origin === "object" && !Array.isArray(origin) ? { ...origin } : {},
    stage: String(stage || "").trim(),
  };
  lifecycle.enterRunning({
    executionOwner: dispatchOwner.owner,
    source: dispatchOwner.source,
    executionId: String(executionId || "").trim(),
    executionKind: dispatchOwner.executionKind,
    parentExecutionId: String(parentExecutionId || "").trim(),
    rootExecutionId: String(rootExecutionId || "").trim(),
    origin: dispatchOwner.origin,
    stage: dispatchOwner.stage,
  });
  syncLifecycleRuntimeState(dispatchRuntime, lifecycle);
  return true;
};

if (resolvedRunConfig?.reuseExistingUserTurn === true) {
  emitEvent(runtimeEventListener, "user_message_reused", {
    sessionId: usedSessionId,
    dialogProcessId,
    turnScopeId: resolvedTurnScopeId,
  });
}

const beforeAgentDispatchContext = {
  ...botHookBase,
  userMessage: normalizedMessage,
  agentContextSummary,
  runtimeAgentContext,
  abortSignal,
  messages: dispatchContextMessages,
  attachments: userMessageAttachments,
  userMessageAttachments,
  eventListener: runtimeEventListener,
  claimAgentDispatch,
};
const beforeAgentDispatchResult = await runBotRuntimeHook({
  runtime: botHookRuntime,
  point: BOT_HOOK_POINTS.BEFORE_AGENT_DISPATCH,
  context: beforeAgentDispatchContext,
  eventListener: runtimeEventListener,
});
const beforeAgentDispatchAbortError = (Array.isArray(beforeAgentDispatchResult?.errors)
  ? beforeAgentDispatchResult.errors
  : []
)
  .map((item) => item?.error || item)
  .find((error) => isAbortError(error));
if (beforeAgentDispatchAbortError) {
  throw beforeAgentDispatchAbortError;
}
const beforeAgentDispatchErrors = (Array.isArray(beforeAgentDispatchResult?.errors)
  ? beforeAgentDispatchResult.errors
  : []
).map((item) => item?.error || item).filter(Boolean);
if (dispatchClaimed && beforeAgentDispatchErrors.length) {
  throw beforeAgentDispatchErrors[0];
}
let agentResult = null;
const effectiveBeforeAgentDispatchContext =
  beforeAgentDispatchResult?.context &&
  typeof beforeAgentDispatchResult.context === "object"
    ? beforeAgentDispatchResult.context
    : beforeAgentDispatchContext;
const dispatchOutcome = resolveBotDispatchOutcome(
  beforeAgentDispatchResult,
  effectiveBeforeAgentDispatchContext,
);
const hasStructuredHandledOutcome = (Array.isArray(beforeAgentDispatchResult?.results)
  ? beforeAgentDispatchResult.results
  : []
).some((item) => (
  item?.ok === true &&
  isBotDispatchOutcome(item?.result) &&
  item.result.disposition === BOT_DISPATCH_DISPOSITION.HANDLED
));
if (dispatchClaimed && dispatchOutcome.disposition === BOT_DISPATCH_DISPOSITION.PASS) {
  const error = new Error("claimed bot dispatch cannot be released to the root Agent");
  error.code = "BOT_DISPATCH_CLAIM_RELEASE_FORBIDDEN";
  error.dispatchOwner = dispatchOwner?.owner || dispatchOwner?.source || "claimed_dispatch";
  throw error;
}
if (hasStructuredHandledOutcome && !dispatchClaimed) {
  const error = new Error("handled bot dispatch outcome requires an earlier ownership claim");
  error.code = "BOT_DISPATCH_CLAIM_REQUIRED";
  error.dispatchOwner = dispatchOutcome.owner;
  throw error;
}
if (
  dispatchClaimed &&
  dispatchOwner?.owner &&
  dispatchOutcome.disposition === BOT_DISPATCH_DISPOSITION.HANDLED &&
  dispatchOutcome.owner !== dispatchOwner.owner
) {
  const error = new Error(
    `bot dispatch claim/outcome owner mismatch: ${dispatchOwner.owner},${dispatchOutcome.owner}`,
  );
  error.code = "BOT_DISPATCH_OWNERSHIP_CONFLICT";
  error.owners = [dispatchOwner.owner, dispatchOutcome.owner];
  throw error;
}
emitEvent(runtimeEventListener, "bot_dispatch_routed", {
  disposition: dispatchOutcome.disposition,
  owner: dispatchOutcome.owner || "root_agent",
  claimed: dispatchClaimed,
  claimedSource: dispatchOwner?.source || "",
  executionKind: dispatchOwner?.executionKind || "agent",
  stage: dispatchOwner?.stage || "",
  failureCode: String(dispatchOutcome?.failure?.code || "").trim(),
});
if (dispatchOutcome.disposition === BOT_DISPATCH_DISPOSITION.HANDLED) {
  if (dispatchOutcome.failure) {
    const dispatchError = new Error(
      String(dispatchOutcome.failure.message || "owned dispatch failed"),
    );
    dispatchError.code = String(dispatchOutcome.failure.code || "BOT_DISPATCH_FAILED").trim();
    dispatchError.dispatchOwner = dispatchOutcome.owner;
    dispatchError.dispatchOutcome = dispatchOutcome;
    throw dispatchError;
  }
  claimAgentDispatch({
    owner: dispatchOutcome.owner,
    source: "before_agent_dispatch_override",
  });
  const override =
    dispatchOutcome?.result && typeof dispatchOutcome.result === "object"
      ? dispatchOutcome.result
      : {};
  agentResult = {
    output: String(override?.output || ""),
    traces: Array.isArray(override?.traces) ? override.traces : [],
    turnMessages: Array.isArray(override?.turnMessages) ? override.turnMessages : [],
    turnTasks: Array.isArray(override?.turnTasks) ? override.turnTasks : [],
    ...(override && typeof override === "object" ? override : {}),
  };
} else {
  try {
    claimAgentDispatch({ source: "agent_dispatch" });
    agentResult = await agentRunner({
      errorLogger: errorLogger,
      agentContext: runtimeAgentContext,
      userMessage: normalizedMessage,
    });
  } catch (error) {
    await runBotRuntimeHook({
      runtime: botHookRuntime,
      point: BOT_HOOK_POINTS.AGENT_DISPATCH_ERROR,
      context: {
        ...botHookBase,
        userMessage: normalizedMessage,
        agentContextSummary,
        error,
      },
      eventListener: runtimeEventListener,
    });
    throw error;
  }
}
await runBotRuntimeHook({
  runtime: botHookRuntime,
  point: BOT_HOOK_POINTS.AFTER_AGENT_DISPATCH,
  context: {
    ...botHookBase,
    userMessage: normalizedMessage,
    agentContextSummary,
    agentResult,
  },
  eventListener: runtimeEventListener,
});
  return agentResult;
}
