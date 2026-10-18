/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

import { emitEvent } from "../../../events/index.js";
import { runBotRuntimeHook } from "../../hook/index.js";
import { HOOK_POINT } from "@noobot/hook-protocol";
import {
  BOT_DISPATCH_DISPOSITION,
  BOT_DISPATCH_ROOT_OWNER,
  isBotDispatchOutcome,
  resolveBotDispatchOutcome,
} from "@noobot/agent-transport-protocol/bot-dispatch";
import { createModelContext } from "@noobot/context-protocol/assembly/hook-context";
import {
  canonicalMessageIdentityDebugData,
  emitContextIdentityDebug,
} from "../../../observability/context-identity-debug.js";
import { getAgentContextEnvelope } from "../../../context/agent-context-accessor.js";
import { text, isFunction, isObjectLike } from "@noobot/shared/value";

function messageIdentity(message = {}) {
  const messageId = text(message?.messageId || message?.additional_kwargs?.noobotMessageId);
  return messageId;
}

function summarizedMessageIds(messages = []) {
  return (Array.isArray(messages) ? messages : [])
    .filter((message = {}) => message?.summarized === true)
    .map((message = {}) => resolveContextMessageId(message))
    .filter(Boolean);
}

function acceptDispatchedTurnMessages(runtime = {}, messages = []) {
  const store = runtime?.currentTurnMessages;
  if (
    !store ||
    !isFunction(store.push) ||
    !isFunction(store.updateWhere) ||
    !isFunction(store.toArray)
  ) {
    throw new Error("bot dispatch requires the canonical currentTurnMessages store");
  }
  const accepted = [];
  for (const message of Array.isArray(messages) ? messages : []) {
    if (!isObjectLike(message)) continue;
    const identity = messageIdentity(message);
    if (!identity) {
      throw new Error("dispatched turn message requires a canonical messageId");
    }
    const updatedCount = store.updateWhere(
      message,
      (current) => messageIdentity(current) === identity,
    );
    if (updatedCount > 1) {
      throw new Error(`canonical turn store contains duplicate messageId: ${identity}`);
    }
    if (updatedCount === 0) store.push(message);
    accepted.push({ messageId: identity, action: updatedCount === 0 ? "inserted" : "updated" });
  }
  return { messages: store.toArray(), accepted };
}

function buildDispatchModelContext({
  context,
  dispatchRuntime,
  runtimeEventListener,
  dialogProcessId,
  resolvedTurnScopeId,
}) {
  const history = Array.isArray(context?.modelContext?.messageBlocks?.history)
    ? context.modelContext.messageBlocks.history
    : [];
  return createModelContext({
    messages: history,
    checkpointRevision: Math.max(0, Number(dispatchRuntime?.summaryCheckpointRevision) || 0),
    activeTurnIdentity: {
      dialogProcessId: text(dialogProcessId),
      turnScopeId: text(resolvedTurnScopeId),
    },
    onCanonicalMessageAdded(message, meta) {
      emitContextIdentityDebug(
        runtimeEventListener,
        "canonicalMessageAdded",
        canonicalMessageIdentityDebugData(message, meta),
      );
    },
    messageBlocks: { system: [], history, incremental: [] },
  });
}

function createDispatchClaim({ lifecycle, dispatchRuntime, syncLifecycleRuntimeState }) {
  const state = { claimed: false, owner: null };
  const claim = ({ owner = "", source = "", ...unexpected } = {}) => {
    const unexpectedFields = Object.keys(unexpected);
    if (unexpectedFields.length > 0) {
      throw new TypeError(
        `agent dispatch claim only declares ownership: ${unexpectedFields.join(",")}`,
      );
    }
    if (!text(owner)) throw new TypeError("agent dispatch claim requires owner");
    if (!text(source)) throw new TypeError("agent dispatch claim requires source");
    if (state.claimed) return false;
    state.claimed = true;
    state.owner = { owner: text(owner), source: text(source) };
    lifecycle.enterRunning({
      executionOwner: state.owner.owner,
      source: state.owner.source,
    });
    syncLifecycleRuntimeState(dispatchRuntime, lifecycle);
    return true;
  };
  return { state, claim };
}

function dispatchError(message, code, fields = {}) {
  return Object.assign(new Error(message), { code, ...fields });
}

function assertDispatchOwnership(hookResult, dispatchOutcome, claimState) {
  const { claimed, owner: claimOwner } = claimState;
  const isHandled = dispatchOutcome.disposition === BOT_DISPATCH_DISPOSITION.HANDLED;
  const hasStructuredHandledOutcome = hookResult.outcomes.some(
    (outcome) =>
      isBotDispatchOutcome(outcome?.value) &&
      outcome.value.disposition === BOT_DISPATCH_DISPOSITION.HANDLED,
  );
  if (claimed && dispatchOutcome.disposition === BOT_DISPATCH_DISPOSITION.PASS) {
    throw dispatchError(
      "claimed bot dispatch cannot be released to the root Agent",
      "BOT_DISPATCH_CLAIM_RELEASE_FORBIDDEN",
      { dispatchOwner: claimOwner.owner },
    );
  }
  if (hasStructuredHandledOutcome && !claimed) {
    throw dispatchError(
      "handled bot dispatch outcome requires an earlier ownership claim",
      "BOT_DISPATCH_CLAIM_REQUIRED",
      { dispatchOwner: dispatchOutcome.owner },
    );
  }
  if (claimed && isHandled && dispatchOutcome.owner !== claimOwner.owner) {
    throw dispatchError(
      `bot dispatch claim/outcome owner mismatch: ${claimOwner.owner},${dispatchOutcome.owner}`,
      "BOT_DISPATCH_OWNERSHIP_CONFLICT",
      { owners: [claimOwner.owner, dispatchOutcome.owner] },
    );
  }
}

function emitDispatchRouted(runtimeEventListener, dispatchOutcome, claimState) {
  const claimOwner = claimState.owner;
  emitEvent(runtimeEventListener, "bot_dispatch_routed", {
    disposition: dispatchOutcome.disposition,
    owner: dispatchOutcome.owner,
    claimed: claimState.claimed,
    claimedSource: claimOwner?.source || "",
    failureCode: text(dispatchOutcome?.failure?.code),
  });
}

function resolveHandledDispatchResult(dispatchOutcome) {
  if (dispatchOutcome.failure) {
    const error = new Error(String(dispatchOutcome.failure.message || "owned dispatch failed"));
    error.code = text(dispatchOutcome.failure.code) || "BOT_DISPATCH_FAILED";
    error.dispatchOwner = dispatchOutcome.owner;
    error.dispatchOutcome = dispatchOutcome;
    throw error;
  }
  const override =
    dispatchOutcome?.result && typeof dispatchOutcome.result === "object"
      ? dispatchOutcome.result
      : {};
  return {
    output: String(override?.output || ""),
    traces: Array.isArray(override?.traces) ? override.traces : [],
    turnMessages: Array.isArray(override?.turnMessages) ? override.turnMessages : [],
    turnTasks: Array.isArray(override?.turnTasks) ? override.turnTasks : [],
    ...override,
  };
}

async function runRootAgent({
  claim,
  agentRunner,
  errorLogger,
  runtimeAgentContext,
  currentUserMessage,
  hookArgs,
}) {
  try {
    claim({ owner: BOT_DISPATCH_ROOT_OWNER, source: "agent_dispatch" });
    return await agentRunner({
      errorLogger,
      agentContext: runtimeAgentContext,
      currentUserMessage,
    });
  } catch (error) {
    await runBotRuntimeHook({
      runtime: hookArgs.botHookRuntime,
      point: HOOK_POINT.BOT.AGENT_DISPATCH_ERROR,
      context: { ...hookArgs.baseContext, error },
    });
    throw error;
  }
}

function acceptAgentResultMessages({
  agentResult,
  dispatchRuntime,
  dispatchOutcome,
  runtimeEventListener,
}) {
  const dispatchedSummarizedMessageIds = summarizedMessageIds(agentResult?.turnMessages);
  const acceptedTurnMessages = acceptDispatchedTurnMessages(
    dispatchRuntime,
    agentResult?.turnMessages,
  );
  agentResult.turnMessages = acceptedTurnMessages.messages;
  emitContextIdentityDebug(runtimeEventListener, "completedTurnSummaryAccepted", {
    resultMessageCount: Array.isArray(agentResult?.turnMessages)
      ? agentResult.turnMessages.length
      : 0,
    dispatchedSummarizedMessageIds,
    acceptedSummarizedMessageIds: summarizedMessageIds(acceptedTurnMessages.messages),
  });
  emitEvent(runtimeEventListener, "canonical_turn_messages_accepted", {
    disposition: dispatchOutcome.disposition,
    owner: dispatchOutcome.owner,
    assistantMessageId: text(agentResult?.assistantMessageId),
    outputChars: String(agentResult?.output || "").length,
    resultAttachmentCount: Array.isArray(agentResult?.attachments)
      ? agentResult.attachments.length
      : 0,
    accepted: acceptedTurnMessages.accepted,
    storeMessageIds: acceptedTurnMessages.messages.map((message) => messageIdentity(message)),
  });
}

export async function dispatchAgentTurn({
  agentRunner,
  errorLogger,
  lifecycle,
  dispatchRuntime,
  runtimeAgentContext,
  normalizedMessage,
  currentUserMessage,
  userMessageAttachments,
  resolvedRunConfig,
  runtimeEventListener,
  botHookRuntime,
  botHookBase,
  agentContextSummary,
  dialogProcessId,
  resolvedTurnScopeId,
  syncLifecycleRuntimeState,
}) {
  const dispatchModelContext = buildDispatchModelContext({
    context: getAgentContextEnvelope(runtimeAgentContext),
    dispatchRuntime,
    runtimeEventListener,
    dialogProcessId,
    resolvedTurnScopeId,
  });
  const { state: claimState, claim } = createDispatchClaim({
    lifecycle,
    dispatchRuntime,
    syncLifecycleRuntimeState,
  });
  if (resolvedRunConfig?.reuseExistingUserTurn === true) {
    emitEvent(runtimeEventListener, "user_message_reused", {});
  }
  const baseContext = { ...botHookBase, userMessage: normalizedMessage, agentContextSummary };
  const beforeAgentDispatchResult = await runBotRuntimeHook({
    runtime: botHookRuntime,
    point: HOOK_POINT.BOT.BEFORE_AGENT_DISPATCH,
    context: {
      ...baseContext,
      agentContext: runtimeAgentContext,
      modelContext: dispatchModelContext,
      attachments: userMessageAttachments,
      userMessageAttachments,
      eventListener: runtimeEventListener,
      claimAgentDispatch: claim,
    },
  });
  const dispatchOutcome = resolveBotDispatchOutcome(beforeAgentDispatchResult);
  assertDispatchOwnership(beforeAgentDispatchResult, dispatchOutcome, claimState);
  emitDispatchRouted(runtimeEventListener, dispatchOutcome, claimState);
  const agentResult =
    dispatchOutcome.disposition === BOT_DISPATCH_DISPOSITION.HANDLED
      ? resolveHandledDispatchResult(dispatchOutcome)
      : await runRootAgent({
          claim,
          agentRunner,
          errorLogger,
          runtimeAgentContext,
          currentUserMessage,
          hookArgs: { botHookRuntime, baseContext },
        });
  acceptAgentResultMessages({
    agentResult,
    dispatchRuntime,
    dispatchOutcome,
    runtimeEventListener,
  });
  await runBotRuntimeHook({
    runtime: botHookRuntime,
    point: HOOK_POINT.BOT.AFTER_AGENT_DISPATCH,
    context: { ...baseContext, agentResult },
  });
  return agentResult;
}
import { resolveContextMessageId } from "@noobot/context-protocol/message/codec";
