/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

import { emitEvent } from "../../../events/index.js";
import { isAbortError } from "../../../shared/utils/error-utils.js";
import { BOT_HOOK_POINTS, runBotRuntimeHook } from "../../hook/index.js";
import {
  BOT_DISPATCH_DISPOSITION,
  isBotDispatchOutcome,
  resolveBotDispatchOutcome,
} from "@noobot/shared/bot-dispatch-protocol";
import { createModelContext } from "@noobot/context-protocol/hook-context";
import {
  canonicalMessageId,
  canonicalMessageIdentityDebugData,
  emitContextIdentityDebug,
} from "../../../observability/context-identity-debug.js";

function messageIdentity(message = {}) {
  const messageId = String(
    message?.messageId ||
      message?.id ||
      message?.additional_kwargs?.noobotMessageId ||
      "",
  ).trim();
  return messageId;
}

function summarizedMessageIds(messages = []) {
  return (Array.isArray(messages) ? messages : [])
    .filter((message = {}) => message?.summarized === true)
    .map((message = {}) => canonicalMessageId(message))
    .filter(Boolean);
}

function acceptDispatchedTurnMessages(runtime = {}, messages = []) {
  const store = runtime?.currentTurnMessages;
  if (
    !store ||
    typeof store.push !== "function" ||
    typeof store.updateWhere !== "function" ||
    typeof store.toArray !== "function"
  ) {
    throw new Error("bot dispatch requires the canonical currentTurnMessages store");
  }
  const accepted = [];
  for (const message of Array.isArray(messages) ? messages : []) {
    if (!message || typeof message !== "object") continue;
    const identity = messageIdentity(message);
    if (!identity) {
      throw new Error("dispatched turn message requires a canonical messageId");
    }
    const updatedCount = store.updateWhere(message, (current) => messageIdentity(current) === identity);
    if (updatedCount > 1) {
      throw new Error(`canonical turn store contains duplicate messageId: ${identity}`);
    }
    if (updatedCount === 0) store.push(message);
    accepted.push({ messageId: identity, action: updatedCount === 0 ? "inserted" : "updated" });
  }
  return { messages: store.toArray(), accepted };
}

export async function dispatchAgentTurn({
  agentRunner,
  errorLogger,
  lifecycle,
  dispatchRuntime,
  runtimeAgentContext,
  abortSignal,
  normalizedMessage,
  currentUserMessage,
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
  // BEFORE_AGENT_DISPATCH runs before the root Agent constructs its final model
  // window. At this boundary the prepared session history is the only model
  // context owned by the dispatcher; system and incremental messages are added
  // later by the selected execution owner.
  const dispatchContextMessages = Array.isArray(runtimeAgentContext?.payload?.messages?.history)
    ? runtimeAgentContext.payload.messages.history
    : [];
  const dispatchModelContext = createModelContext({
    messages: dispatchContextMessages,
    activeTurnIdentity: {
      dialogProcessId: String(dialogProcessId || "").trim(),
      turnScopeId: String(resolvedTurnScopeId || "").trim(),
    },
    onCanonicalMessageAdded(message, meta) {
      emitContextIdentityDebug(
        runtimeEventListener,
        "canonicalMessageAdded",
        {
          userId: usedSessionId ? String(normalizedMessage?.userId || "").trim() : "",
          sessionId: usedSessionId,
          dialogProcessId,
          turnScopeId: resolvedTurnScopeId,
        },
        canonicalMessageIdentityDebugData(message, meta),
      );
    },
    messageBlocks: {
      system: [],
      history: dispatchContextMessages,
      incremental: [],
    },
  });

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
  agentContext: runtimeAgentContext,
  abortSignal,
  modelContext: dispatchModelContext,
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
const dispatchOutcome = resolveBotDispatchOutcome(beforeAgentDispatchResult);
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
      currentUserMessage,
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
const dispatchedSummarizedMessageIds = summarizedMessageIds(agentResult?.turnMessages);
const acceptedTurnMessages = acceptDispatchedTurnMessages(dispatchRuntime, agentResult?.turnMessages);
agentResult.turnMessages = acceptedTurnMessages.messages;
emitContextIdentityDebug(
  runtimeEventListener,
  "completedTurnSummaryAccepted",
  {
    sessionId: usedSessionId,
    dialogProcessId,
    turnScopeId: resolvedTurnScopeId,
  },
  {
    resultMessageCount: Array.isArray(agentResult?.turnMessages)
      ? agentResult.turnMessages.length
      : 0,
    dispatchedSummarizedMessageIds,
    acceptedSummarizedMessageIds: summarizedMessageIds(acceptedTurnMessages.messages),
  },
);
emitEvent(runtimeEventListener, "canonical_turn_messages_accepted", {
  sessionId: usedSessionId,
  dialogProcessId,
  turnScopeId: resolvedTurnScopeId,
  disposition: dispatchOutcome.disposition,
  owner: dispatchOutcome.owner || "root_agent",
  assistantMessageId: String(agentResult?.assistantMessageId || "").trim(),
  outputChars: String(agentResult?.output || "").length,
  resultAttachmentCount: Array.isArray(agentResult?.attachments) ? agentResult.attachments.length : 0,
  accepted: acceptedTurnMessages.accepted,
  storeMessageIds: acceptedTurnMessages.messages.map((message) => messageIdentity(message)),
});
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
