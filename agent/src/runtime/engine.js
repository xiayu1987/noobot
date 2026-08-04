/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */


import { buildAgentState } from "./state-builder.js";
import { runFunctionCallLoop } from "./turn/orchestrator.js";
import { readFinalStreamingResultMeta } from "./turn/turn-result-aggregator.js";
import { runAgentRuntimeHook, AGENT_HOOK_POINTS } from "../extensions/hooks/index.js";
import { isAbortError } from "./utils/error-utils.js";
import { buildHookContext } from "./hooks/hook-context-builder.js";
import { emitEvent } from "../events/index.js";
import { getSystemRuntimeFromRuntime } from "../context/agent-context-accessor.js";
import {
  emitMessageEvent,
} from "../events/message-event-stream.js";

function messageIdentity(message = {}) {
  return String(
    message?.messageId ||
    message?.id ||
    message?.additional_kwargs?.noobotMessageId ||
    "",
  ).trim();
}

function canonicalTurnMessages(runtime = {}) {
  const store = runtime?.currentTurnMessages;
  if (!store || typeof store.toArray !== "function") {
    throw new Error("authoritative final result requires the canonical currentTurnMessages store");
  }
  return store.toArray();
}

function authoritativeFinalMessages(result = {}, runtime = {}) {
  const messageId = String(result?.assistantMessageId || "").trim();
  if (!messageId) return [];
  return canonicalTurnMessages(runtime).filter(
    (message) => message && typeof message === "object" && messageIdentity(message) === messageId,
  );
}

function authoritativeFinalDiagnostics(result = {}, runtime = {}) {
  const messages = canonicalTurnMessages(runtime);
  const assistantMessageId = String(result?.assistantMessageId || "").trim();
  const matches = messages.filter(
    (message) => message && typeof message === "object" && messageIdentity(message) === assistantMessageId,
  );
  return {
    assistantMessageId,
    outputChars: String(result?.output || "").length,
    storeMessageCount: messages.length,
    storeMessageIds: messages.map((message) => messageIdentity(message)),
    matchCount: matches.length,
    matchedPresentationMessageIds: matches.map((message) => String(message?.presentationMessageId || "").trim()),
    attachmentCount: matches.length === 1 && Array.isArray(matches[0]?.attachments)
      ? matches[0].attachments.length
      : 0,
    transferEnvelopeCount: matches.length === 1 && Array.isArray(matches[0]?.transferEnvelopes)
      ? matches[0].transferEnvelopes.length
      : 0,
  };
}

export function commitAuthoritativeFinalOutput({ result = {}, runtime = {} } = {}) {
  const finalOutput = String(result?.output || "");
  const messageId = String(result?.assistantMessageId || "").trim();
  if (!finalOutput || !messageId) return false;
  const store = runtime?.currentTurnMessages;
  const matches = authoritativeFinalMessages(result, runtime);
  if (matches.length !== 1) return false;
  const finalMessage = matches[0];
  const updatedCount = store.updateWhere({
    content: finalOutput,
    ...(Array.isArray(finalMessage?.attachments) ? { attachments: finalMessage.attachments } : {}),
    ...(Array.isArray(finalMessage?.transferEnvelopes)
      ? { transferEnvelopes: finalMessage.transferEnvelopes }
      : {}),
  }, (message) => messageIdentity(message) === messageId);
  if (updatedCount !== 1) return false;
  result.turnMessages = store.toArray();
  return true;
}

export function emitAuthoritativeFinalMessageContent({ result = {}, runtime = {} } = {}) {
  const eventListener = runtime?.eventListener || null;
  const finalOutput = String(result?.output || "");
  const messageId = String(result?.assistantMessageId || "").trim();
  if (!eventListener?.onEvent || !finalOutput || !messageId) return false;
  const messages = authoritativeFinalMessages(result, runtime);
  if (messages.length === 0) return false;
  const finalMessage = messages[0];
  const transferEnvelopes = Array.isArray(finalMessage?.transferEnvelopes)
    ? finalMessage.transferEnvelopes
    : (Array.isArray(result?.transferEnvelopes) ? result.transferEnvelopes : []);
  const attachments = Array.isArray(finalMessage?.attachments)
    ? finalMessage.attachments
    : (Array.isArray(result?.attachments) ? result.attachments : []);
  const event = emitMessageEvent(eventListener, runtime, "authoritative_final_content", {
    text: finalOutput,
    output: finalOutput,
    dialogProcessId: String(runtime?.systemRuntime?.dialogProcessId || "").trim(),
    category: "model",
    type: "authoritative_final_content",
    source: "before_final_output_committed",
    ...(transferEnvelopes.length ? { transferEnvelopes } : {}),
    ...(attachments.length ? { attachments } : {}),
  });
  return event;
}

/** The sole authoritative final-result boundary for every dispatch disposition. */
export function commitAuthoritativeFinalResult({ result = {}, runtime = {} } = {}) {
  const diagnostics = authoritativeFinalDiagnostics(result, runtime);
  emitEvent(runtime?.eventListener || null, "authoritative_final_commit_started", diagnostics);
  const messages = authoritativeFinalMessages(result, runtime);
  if (String(result?.output || "") && messages.length !== 1) {
    emitEvent(runtime?.eventListener || null, "authoritative_final_commit_rejected", {
      ...diagnostics,
      reason: messages.length === 0 ? "canonical_message_not_found" : "duplicate_canonical_message",
    });
    throw new Error(
      messages.length === 0
        ? "authoritative final result does not match its canonical messageId"
        : "authoritative final result matches multiple canonical messages",
    );
  }
  if (!messages.length || !String(result?.output || "")) {
    emitEvent(runtime?.eventListener || null, "authoritative_final_commit_skipped", {
      ...diagnostics,
      reason: !String(result?.output || "") ? "empty_output" : "canonical_message_not_found",
    });
    return false;
  }
  if (!commitAuthoritativeFinalOutput({ result, runtime })) {
    throw new Error("authoritative final result failed to update the canonical message");
  }
  emitFinalStreamingAppendDeltaAfterHooks({ result, runtime });
  const event = emitAuthoritativeFinalMessageContent({ result, runtime });
  if (!event) throw new Error("authoritative final result failed to emit its message event");
  emitEvent(runtime?.eventListener || null, "authoritative_final_commit_completed", {
    ...authoritativeFinalDiagnostics(result, runtime),
    eventId: String(event?.eventId || "").trim(),
    messageId: String(event?.messageId || "").trim(),
    presentationMessageId: String(event?.presentationMessageId || "").trim(),
  });
  return true;
}

export function emitFinalStreamingAppendDeltaAfterHooks({ result = {}, runtime = {} } = {}) {
  const meta = readFinalStreamingResultMeta(result);
  if (meta?.streamed !== true) return false;

  const streamedOutput = String(meta?.output || "");
  const finalOutput = String(result?.output || "");
  if (!streamedOutput || finalOutput.length <= streamedOutput.length) return false;

  const eventListener = runtime?.eventListener || null;
  if (!eventListener?.onEvent) return false;

  const comparablePrefixes = [streamedOutput, streamedOutput.trim()]
    .filter(Boolean)
    .filter((item, index, list) => list.indexOf(item) === index);
  const matchedPrefix = comparablePrefixes.find((prefix) => finalOutput.startsWith(prefix));
  if (!matchedPrefix) {
    emitEvent(eventListener, "llm_final_stream_append_delta_skipped", {
      reason: "final_output_not_prefixed_by_streamed_output",
      streamedChars: streamedOutput.length,
      finalChars: finalOutput.length,
      mode: String(meta?.mode || ""),
    });
    return false;
  }

  const appendedText = finalOutput.slice(matchedPrefix.length);
  if (!appendedText) return false;

  const systemRuntime = getSystemRuntimeFromRuntime(runtime);
  emitMessageEvent(eventListener, runtime, "llm_delta", {
    text: appendedText,
    dialogProcessId: String(runtime?.systemRuntime?.dialogProcessId || "").trim(),
    sessionId: String(systemRuntime?.sessionId || runtime?.sessionId || "").trim(),
    category: "model",
    type: "final_output_append_delta",
    source: "before_final_output_append",
  });
  emitEvent(eventListener, "llm_final_stream_append_delta_emitted", {
    appendedChars: appendedText.length,
    finalChars: finalOutput.length,
    mode: String(meta?.mode || ""),
  });
  return true;
}

export function assertHookExecutionSucceeded(hookResult = {}, point = "") {
  const failure = (Array.isArray(hookResult?.errors) ? hookResult.errors : [])
    .map((item) => item?.error || item)
    .find(Boolean);
  if (!failure) return hookResult;
  if (failure instanceof Error) throw failure;
  throw new Error(`hook failed: ${String(point || hookResult?.point || "unknown").trim() || "unknown"}`);
}

export async function runAgentTurn({ agentContext, currentUserMessage, errorLogger = null }) {
  const runtime = agentContext?.bindings?.runtime || {};
  const userMessage = String(currentUserMessage?.content || "");
  const startedAtMs = Date.now();
  const startedAt = new Date(startedAtMs).toISOString();
  await runAgentRuntimeHook({
    runtime,
    point: AGENT_HOOK_POINTS.BEFORE_TURN,
    context: buildHookContext(AGENT_HOOK_POINTS.BEFORE_TURN, runtime, {
      phase: "agent_turn",
      status: "start",
      startedAt,
      agentContext,
      userMessage,
    }),
  });
  const { modelState, loopState } = buildAgentState({ agentContext, currentUserMessage, errorLogger });
  const modelContext = loopState.modelContext;
  try {
    const result = await runFunctionCallLoop({ modelState, loopState, turn: 1 });
    const beforeFinalAtMs = Date.now();
    const beforeFinalHookResult = await runAgentRuntimeHook({
      runtime,
      point: AGENT_HOOK_POINTS.BEFORE_FINAL_OUTPUT,
      context: buildHookContext(AGENT_HOOK_POINTS.BEFORE_FINAL_OUTPUT, runtime, {
        phase: "agent_turn",
        status: "success",
        startedAt,
        endedAt: new Date(beforeFinalAtMs).toISOString(),
        durationMs: beforeFinalAtMs - startedAtMs,
        agentContext,
        userMessage,
        result,
        modelContext,
      }),
    });
    assertHookExecutionSucceeded(beforeFinalHookResult, AGENT_HOOK_POINTS.BEFORE_FINAL_OUTPUT);
    const endedAtMs = Date.now();
    await runAgentRuntimeHook({
      runtime,
      point: AGENT_HOOK_POINTS.AFTER_TURN,
      context: buildHookContext(AGENT_HOOK_POINTS.AFTER_TURN, runtime, {
        phase: "agent_turn",
        status: "success",
        startedAt,
        endedAt: new Date(endedAtMs).toISOString(),
        durationMs: endedAtMs - startedAtMs,
        agentContext,
        userMessage,
        result,
        modelContext,
      }),
    });
    return result;
  } catch (error) {
    const failedAtMs = Date.now();
    if (isAbortError(error) || isAbortError(error?.cause)) {
      await runAgentRuntimeHook({
        runtime,
        point: AGENT_HOOK_POINTS.ON_ABORT,
        context: buildHookContext(AGENT_HOOK_POINTS.ON_ABORT, runtime, {
          phase: "agent_turn",
          status: "abort",
          startedAt,
          endedAt: new Date(failedAtMs).toISOString(),
          durationMs: failedAtMs - startedAtMs,
          agentContext,
          userMessage,
          error,
          modelContext,
        }),
      });
    }
    await runAgentRuntimeHook({
      runtime,
      point: AGENT_HOOK_POINTS.ON_ERROR,
      context: buildHookContext(AGENT_HOOK_POINTS.ON_ERROR, runtime, {
        phase: "agent_turn",
        status: "error",
        startedAt,
        endedAt: new Date(failedAtMs).toISOString(),
        durationMs: failedAtMs - startedAtMs,
        agentContext,
        userMessage,
        error,
        modelContext,
      }),
    });
    throw error;
  }
}
