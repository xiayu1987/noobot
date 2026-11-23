/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

import { buildAgentState } from "./state-builder.js";
import { getRuntimeFromAgentContext } from "../context/agent-context-accessor.js";
import { runFunctionCallLoop } from "./turn/orchestrator.js";
import { runAgentRuntimeHook } from "../extensions/hooks/index.js";
import { HOOK_PHASE_STATUS, HOOK_POINT } from "@noobot/hook-protocol";
import { isAbortError } from "../shared/utils/error-utils.js";
import { buildHookContext } from "./hooks/hook-context-builder.js";
import { emitEvent, hasEventListener } from "../events/index.js";
import { emitMessageEvent } from "../events/message-event-stream.js";
import { projectGeneratedArtifactsToFinalAssistant } from "./turn/final-assistant-artifact-projection.js";
import { requireCurrentTurnMessagesStore } from "./turn/current-turn-ledger.js";
import { assertAgentTurnResult } from "@noobot/agent-transport-protocol/agent-turn-result";
import { applyTurnCompletionPolicy } from "@noobot/context-protocol/policy/turn-completion";
import { text } from "@noobot/shared/value";

function resultModelMessageId(result) {
  return text(result.modelMessageId);
}

function authoritativeFinalMessages(result, runtime) {
  const modelMessageId = resultModelMessageId(result);
  if (!modelMessageId) return [];
  return requireCurrentTurnMessagesStore(runtime.currentTurnMessages).readMessagesByModelMessageId(
    modelMessageId,
  );
}

function finalMessageArtifacts(finalMessage) {
  const { attachments, transferEnvelopes } = finalMessage;
  return {
    ...(Array.isArray(attachments) && attachments.length ? { attachments } : {}),
    ...(Array.isArray(transferEnvelopes) && transferEnvelopes.length ? { transferEnvelopes } : {}),
  };
}

function authoritativeFinalDiagnostics(result, runtime) {
  const counts = requireCurrentTurnMessagesStore(runtime.currentTurnMessages).readCounts();
  const matches = authoritativeFinalMessages(result, runtime);
  const artifacts = matches.length === 1 ? finalMessageArtifacts(matches[0]) : {};
  return {
    modelMessageId: resultModelMessageId(result),
    outputChars: result.output.length,
    storeMessageCount: counts.messageCount,
    matchCount: matches.length,
    matchedPresentationMessageIds: matches.map((message) => text(message.presentationMessageId)),
    attachmentCount: artifacts.attachments ? artifacts.attachments.length : 0,
    transferEnvelopeCount: artifacts.transferEnvelopes ? artifacts.transferEnvelopes.length : 0,
  };
}

export function commitAuthoritativeFinalOutput({ result, runtime }) {
  const modelMessageId = resultModelMessageId(result);
  if (!result.output || !modelMessageId) return false;
  const store = requireCurrentTurnMessagesStore(runtime.currentTurnMessages);
  const matches = authoritativeFinalMessages(result, runtime);
  if (matches.length !== 1) return false;
  const updated = store.updateByUid(matches[0].messageUid, {
    content: result.output,
    ...finalMessageArtifacts(matches[0]),
  });
  if (!updated) return false;
  result.turnMessages = store.readResultMessages();
  return true;
}

export async function emitAuthoritativeFinalMessageContent({ result, runtime }) {
  const { eventListener } = runtime;
  if (!hasEventListener(eventListener) || !result.output || !resultModelMessageId(result)) {
    return false;
  }
  const messages = authoritativeFinalMessages(result, runtime);
  if (messages.length === 0) return false;
  return emitMessageEvent(eventListener, runtime, "authoritative_final_content", {
    text: result.output,
    dialogProcessId: text(runtime.systemRuntime.dialogProcessId),
    source: "before_final_output_committed",
    ...finalMessageArtifacts(messages[0]),
  });
}

export async function commitAuthoritativeFinalResult({ result, runtime }) {
  assertAgentTurnResult(result);
  const store = requireCurrentTurnMessagesStore(runtime.currentTurnMessages);
  const { summaryCheckpointPromotionSources: promotionSources, eventListener } = runtime;
  const finalAssistant = store.readFinalAssistant();
  if (finalAssistant) {
    const sources = store.readArtifactProjectionSources();
    const target = sources.findIndex((message) => message.messageUid === finalAssistant.messageUid);
    const projected = projectGeneratedArtifactsToFinalAssistant([...promotionSources, ...sources])[
      promotionSources.length + target
    ];
    if (projected !== sources[target]) {
      store.updateByUid(finalAssistant.messageUid, {
        attachments: projected.attachments,
        transferEnvelopes: projected.transferEnvelopes,
      });
    }
  }
  applyTurnCompletionPolicy({
    modelMessages: result.modelMessages,
    turnMessageStore: store,
  });
  result.turnMessages = store.readResultMessages();
  const diagnostics = authoritativeFinalDiagnostics(result, runtime);
  emitEvent(eventListener, "authoritative_final_commit_started", diagnostics);
  const messages = authoritativeFinalMessages(result, runtime);
  if (result.output && messages.length !== 1) {
    emitEvent(eventListener, "authoritative_final_commit_rejected", {
      ...diagnostics,
      reason: messages.length === 0 ? "canonical_message_not_found" : "duplicate_canonical_message",
    });
    throw new Error(
      messages.length === 0
        ? "authoritative final result does not match its canonical modelMessageId"
        : "authoritative final result matches multiple canonical messages",
    );
  }
  if (!result.output) {
    emitEvent(eventListener, "authoritative_final_commit_skipped", {
      ...diagnostics,
      reason: "empty_output",
    });
    return false;
  }
  if (!commitAuthoritativeFinalOutput({ result, runtime })) {
    throw new Error("authoritative final result failed to update the canonical message");
  }
  const event = await emitAuthoritativeFinalMessageContent({ result, runtime });
  if (!event) throw new Error("authoritative final result failed to emit its message event");
  emitEvent(eventListener, "authoritative_final_commit_completed", {
    ...authoritativeFinalDiagnostics(result, runtime),
    eventId: text(event.identity.eventId),
    presentationMessageId: text(event.payload.presentationMessageId),
  });
  return true;
}

export async function runAgentTurn({ agentContext, currentUserMessage, errorLogger = null }) {
  const runtime = getRuntimeFromAgentContext(agentContext);
  const userMessage = currentUserMessage.content;
  const startedAtMs = Date.now();
  const startedAt = new Date(startedAtMs).toISOString();
  await runAgentRuntimeHook({
    runtime,
    point: HOOK_POINT.AGENT.BEFORE_TURN,
    context: buildHookContext(HOOK_POINT.AGENT.BEFORE_TURN, runtime, {
      phase: "agent_turn",
      status: HOOK_PHASE_STATUS.RUNNING,
      startedAt,
      agentContext,
      userMessage,
    }),
  });
  const { modelState, loopState } = buildAgentState({
    agentContext,
    currentUserMessage,
    errorLogger,
  });
  try {
    const result = await runFunctionCallLoop({ modelState, loopState, turn: 1 });
    const beforeFinalAtMs = Date.now();
    await runAgentRuntimeHook({
      runtime,
      point: HOOK_POINT.AGENT.BEFORE_FINAL_OUTPUT,
      context: buildHookContext(HOOK_POINT.AGENT.BEFORE_FINAL_OUTPUT, runtime, {
        phase: "agent_turn",
        status: HOOK_PHASE_STATUS.SUCCESS,
        startedAt,
        endedAt: new Date(beforeFinalAtMs).toISOString(),
        durationMs: beforeFinalAtMs - startedAtMs,
        agentContext,
        userMessage,
        result,
      }),
    });
    const endedAtMs = Date.now();
    await runAgentRuntimeHook({
      runtime,
      point: HOOK_POINT.AGENT.AFTER_TURN,
      context: buildHookContext(HOOK_POINT.AGENT.AFTER_TURN, runtime, {
        phase: "agent_turn",
        status: HOOK_PHASE_STATUS.SUCCESS,
        startedAt,
        endedAt: new Date(endedAtMs).toISOString(),
        durationMs: endedAtMs - startedAtMs,
        agentContext,
        userMessage,
        result,
      }),
    });
    return result;
  } catch (error) {
    const failedAtMs = Date.now();
    const aborted = isAbortError(error, runtime.abortSignal);
    const failurePoint = aborted ? HOOK_POINT.AGENT.ON_ABORT : HOOK_POINT.AGENT.ON_ERROR;
    await runAgentRuntimeHook({
      runtime,
      point: failurePoint,
      context: buildHookContext(failurePoint, runtime, {
        phase: "agent_turn",
        status: aborted ? HOOK_PHASE_STATUS.ABORT : HOOK_PHASE_STATUS.ERROR,
        startedAt,
        endedAt: new Date(failedAtMs).toISOString(),
        durationMs: failedAtMs - startedAtMs,
        agentContext,
        userMessage,
        error,
      }),
    });
    throw error;
  }
}
