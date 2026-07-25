/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

import { pruneSummarizedIncrementalMessages } from "../../agent/core/message-context/message-store.js";

function isSummarized(message = {}) {
  return message?.summarized === true || message?.lc_kwargs?.summarized === true;
}

function resolveMessageId(message = {}) {
  return String(
    message?.noobotMessageId ||
      message?.messageId ||
      message?.additional_kwargs?.noobotMessageId ||
      message?.additional_kwargs?.messageId ||
      message?.lc_kwargs?.noobotMessageId ||
      message?.lc_kwargs?.messageId ||
      message?.lc_kwargs?.additional_kwargs?.noobotMessageId ||
      message?.lc_kwargs?.additional_kwargs?.messageId ||
      "",
  ).trim();
}

function resolveRole(message = {}) {
  const role = String(message?.role || message?.lc_kwargs?.role || "").trim().toLowerCase();
  if (role) return role;
  const type = String(message?.type || message?.lc_kwargs?.type || "").trim().toLowerCase();
  if (type === "ai") return "assistant";
  if (type === "human") return "user";
  return type;
}

function resolveContent(message = {}) {
  return String(message?.content ?? message?.lc_kwargs?.content ?? "");
}

function resolveToolCallId(message = {}) {
  return String(
    message?.tool_call_id || message?.toolCallId || message?.lc_kwargs?.tool_call_id || "",
  ).trim();
}

function resolveToolCalls(message = {}) {
  const calls = Array.isArray(message?.tool_calls)
    ? message.tool_calls
    : Array.isArray(message?.lc_kwargs?.tool_calls)
      ? message.lc_kwargs.tool_calls
      : [];
  return calls.map((call = {}) => ({
    id: String(call?.id || call?.tool_call_id || "").trim(),
    name: String(call?.name || call?.function?.name || "").trim(),
  }));
}

function buildMessageIdentity(message = {}) {
  return JSON.stringify({
    role: resolveRole(message),
    content: resolveContent(message),
    toolCallId: resolveToolCallId(message),
    toolCalls: resolveToolCalls(message),
    injectedMessageType: String(
      message?.injectedMessageType ||
        message?.injected_message_type ||
        message?.additional_kwargs?.injectedMessageType ||
        message?.lc_kwargs?.additional_kwargs?.injectedMessageType ||
        "",
    ).trim(),
    dialogProcessId: String(
      message?.dialogProcessId || message?.lc_kwargs?.dialogProcessId || "",
    ).trim(),
  });
}

function createMessageMultisetMarker(messages = [], messageIds = []) {
  const remainingIds = new Set(
    (Array.isArray(messageIds) ? messageIds : [])
      .map((id) => String(id || "").trim())
      .filter(Boolean),
  );
  const remainingByIdentity = new Map();
  for (const message of Array.isArray(messages) ? messages : []) {
    const key = buildMessageIdentity(message);
    remainingByIdentity.set(key, (remainingByIdentity.get(key) || 0) + 1);
  }
  return (message) => {
    const id = resolveMessageId(message);
    const key = buildMessageIdentity(message);
    if (id && remainingIds.delete(id)) {
      const remaining = remainingByIdentity.get(key) || 0;
      if (remaining === 1) remainingByIdentity.delete(key);
      else if (remaining > 1) remainingByIdentity.set(key, remaining - 1);
      return true;
    }
    const remaining = remainingByIdentity.get(key) || 0;
    if (remaining <= 0) return false;
    if (remaining === 1) remainingByIdentity.delete(key);
    else remainingByIdentity.set(key, remaining - 1);
    return true;
  };
}

function createSummaryCompletionMarker(summaryCompletion = null) {
  if (!summaryCompletion || typeof summaryCompletion !== "object") return null;
  if (
    !Array.isArray(summaryCompletion.summarizedMessageIds) &&
    !Array.isArray(summaryCompletion.summarizedMessages)
  ) return null;
  return () => createMessageMultisetMarker(
    summaryCompletion.summarizedMessages,
    summaryCompletion.summarizedMessageIds,
  );
}

function compactPromotionSource(message = {}) {
  const attachments = Array.isArray(message?.attachments) ? message.attachments : [];
  const transferEnvelopes = Array.isArray(message?.transferEnvelopes)
    ? message.transferEnvelopes
    : [];
  if (!attachments.length && !transferEnvelopes.length) return null;
  return {
    role: String(message?.role || "").trim(),
    type: String(message?.type || "").trim(),
    ...(attachments.length ? { attachments } : {}),
    ...(transferEnvelopes.length ? { transferEnvelopes } : {}),
  };
}

export async function commitSummaryCheckpoint({
  session = null,
  turnPersister = null,
  runtime = null,
  userId = "",
  sessionId = "",
  parentSessionId = "",
  dialogProcessId = "",
  parentDialogProcessId = "",
  turnScopeId = "",
  eventListener = null,
  persistenceContext = null,
  shouldMark = null,
  summaryCompletion = null,
} = {}) {
  const currentTurnMessages = runtime?.currentTurnMessages;
  if (
    !userId ||
    !sessionId ||
    !currentTurnMessages ||
    typeof currentTurnMessages.toArray !== "function" ||
    typeof currentTurnMessages.replaceAll !== "function" ||
    typeof session?.markSessionMessagesSummarized !== "function"
  ) {
    return { committed: false, persistedCount: 0, markedCount: 0 };
  }

  const turnMessages = currentTurnMessages.toArray();
  const createSummaryMarker = createSummaryCompletionMarker(summaryCompletion);
  if (createSummaryMarker) {
    const currentTurnMarker = createSummaryMarker();
    currentTurnMessages.updateWhere(
      { summarized: true },
      (message) => !isSummarized(message) && currentTurnMarker(message),
    );
  }
  const markedTurnMessages = currentTurnMessages.toArray();
  const persistedPrefixCount = Math.min(
    markedTurnMessages.length,
    Math.max(0, Number(runtime?.summaryCheckpointPersistedCount) || 0),
  );
  const pendingMessages = markedTurnMessages.slice(persistedPrefixCount);

  if (pendingMessages.length) {
    await turnPersister.appendAgentMessages({
      userId,
      sessionId,
      parentSessionId,
      messages: pendingMessages,
      dialogProcessId,
      parentDialogProcessId,
      turnScopeId,
      eventListener,
      persistenceContext,
    });
    // Turns persistence is already durable at this point. Keep the cursor even
    // if the following archive mutation fails so the finalizer cannot duplicate
    // this prefix; memory is only released after the archive mutation succeeds.
    runtime.summaryCheckpointPersistedCount = markedTurnMessages.length;
    runtime.summaryCheckpointPersistedTotal =
      Math.max(0, Number(runtime?.summaryCheckpointPersistedTotal) || 0) + pendingMessages.length;
  }

  const markedCount = await session.markSessionMessagesSummarized({
    userId,
    sessionId,
    parentSessionId,
    persistenceContext,
    shouldMark: createSummaryMarker ? createSummaryMarker() : shouldMark,
    forceArchive: true,
  });
  const committed = pendingMessages.length > 0 || Number(markedCount) > 0;
  if (!committed) {
    // The messages were appended successfully and must not be appended again
    // by a later checkpoint or the final tail flush.
    runtime.summaryCheckpointPersistedCount = markedTurnMessages.length;
    return { committed: false, persistedCount: pendingMessages.length, markedCount: 0 };
  }

  const retainedMessages = markedTurnMessages.filter((message) => !isSummarized(message));
  const promotionSources = markedTurnMessages
    .filter(isSummarized)
    .map(compactPromotionSource)
    .filter(Boolean);
  if (promotionSources.length) {
    runtime.summaryCheckpointPromotionSources = [
      ...(Array.isArray(runtime?.summaryCheckpointPromotionSources)
        ? runtime.summaryCheckpointPromotionSources
        : []),
      ...promotionSources,
    ];
  }
  currentTurnMessages.replaceAll(retainedMessages);
  if (runtime?.activeMessageContext && typeof runtime.activeMessageContext === "object") {
    pruneSummarizedIncrementalMessages(runtime.activeMessageContext);
  }
  runtime.summaryCheckpointPersistedCount = retainedMessages.length;
  return {
    committed: true,
    persistedCount: pendingMessages.length,
    markedCount: Number(markedCount) || 0,
  };
}
