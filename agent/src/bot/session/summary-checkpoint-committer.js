/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

import {
  markContextMessagesSummarized as markMessagesSummarizedByIds,
  pruneContextSummarizedIncremental as pruneSummarizedIncrementalMessages,
} from "@noobot/context-protocol/mutation/context";
import { createHash } from "node:crypto";
import { emitEvent } from "../../events/index.js";
import {
  collectLatestCheckpointEvidenceMessageIndexes,
  hasCheckpointBoundaryToolCall,
} from "@noobot/context-protocol/policy/summary";
import { applyPendingUserMetaBackwrites } from "../../context/assembly/message-builder/user-meta-backwrite.js";

function isSummarized(message = {}) {
  return message?.summarized === true || message?.lc_kwargs?.summarized === true;
}

function resolveMessageId(message = {}) {
  return String(
    message?.messageUid ||
      message?.additional_kwargs?.noobotMessageId ||
      message?.lc_kwargs?.additional_kwargs?.noobotMessageId ||
      "",
  ).trim();
}

function createSummaryCompletionMarker(summaryCompletion = null) {
  if (!summaryCompletion || typeof summaryCompletion !== "object") return null;
  if (!Array.isArray(summaryCompletion.summarizedMessageIds)) return null;
  const summarizedMessageIds = new Set(
    summaryCompletion.summarizedMessageIds.map((id) => String(id || "").trim()).filter(Boolean),
  );
  return () => (message) => summarizedMessageIds.has(resolveMessageId(message));
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

function resolveMessageUid(message = {}) {
  return String(message?.messageUid || "").trim();
}

function buildCheckpointId({
  dialogProcessId = "",
  turnScopeId = "",
  persistedMessageUids = [],
  summarizedMessageUids = [],
  retainedMessageUids = [],
} = {}) {
  const digest = createHash("sha256")
    .update(
      JSON.stringify({
        dialogProcessId,
        turnScopeId,
        persistedMessageUids,
        summarizedMessageUids,
        retainedMessageUids,
      }),
    )
    .digest("hex")
    .slice(0, 32);
  return `summary_checkpoint_${digest}`;
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
  summaryCompletion = null,
} = {}) {
  const currentTurnMessages = runtime?.currentTurnMessages;
  if (
    !userId ||
    !sessionId ||
    !currentTurnMessages ||
    typeof currentTurnMessages.toArray !== "function" ||
    typeof currentTurnMessages.replaceAll !== "function" ||
    typeof session?.commitTurnSummaryCheckpoint !== "function"
  ) {
    return { committed: false, persistedCount: 0, markedCount: 0 };
  }

  const turnMessages = currentTurnMessages.toArray();
  const summaryCallIndex = turnMessages.findLastIndex((message) =>
    hasCheckpointBoundaryToolCall(message),
  );
  const checkpointEvidenceScope =
    summaryCallIndex >= 0 ? turnMessages.slice(0, summaryCallIndex) : turnMessages;
  const retainedCheckpointEvidenceIds = new Set(
    [...collectLatestCheckpointEvidenceMessageIndexes(checkpointEvidenceScope)]
      .map((index) => resolveMessageUid(checkpointEvidenceScope[index]))
      .filter(Boolean),
  );
  const normalizedSummaryCompletion =
    summaryCompletion && typeof summaryCompletion === "object"
      ? {
          ...summaryCompletion,
          summarizedMessageIds: Array.isArray(summaryCompletion.summarizedMessageIds)
            ? summaryCompletion.summarizedMessageIds.filter(
                (id) => !retainedCheckpointEvidenceIds.has(String(id || "").trim()),
              )
            : summaryCompletion.summarizedMessageIds,
        }
      : summaryCompletion;
  const createSummaryMarker = createSummaryCompletionMarker(normalizedSummaryCompletion);
  const persistedPrefixCount = Math.min(
    turnMessages.length,
    Math.max(0, Number(runtime?.summaryCheckpointPersistedCount) || 0),
  );
  const durablyPersistedMessageUids = new Set(
    [
      ...(Array.isArray(runtime?.timelineCheckpointPersistedMessageUids)
        ? runtime.timelineCheckpointPersistedMessageUids
        : []),
      ...(Array.isArray(runtime?.summaryCheckpointPersistedMessageUids)
        ? runtime.summaryCheckpointPersistedMessageUids
        : []),
    ]
      .map((uid) => String(uid || "").trim())
      .filter(Boolean),
  );
  const canUseDurableMessageUids = turnMessages.every((message) => resolveMessageUid(message));
  const pendingMessages = canUseDurableMessageUids
    ? turnMessages.filter((message) => !durablyPersistedMessageUids.has(resolveMessageUid(message)))
    : turnMessages.slice(persistedPrefixCount);

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
    runtime.summaryCheckpointPersistedCount = turnMessages.length;
    runtime.summaryCheckpointPersistedTotal =
      Math.max(0, Number(runtime?.summaryCheckpointPersistedTotal) || 0) + pendingMessages.length;
  }

  const newlyPersistedMessageUids = pendingMessages.map(resolveMessageUid).filter(Boolean);
  const persistedMessageUids = turnMessages
    .map(resolveMessageUid)
    .filter(
      (messageUid) =>
        durablyPersistedMessageUids.has(messageUid) ||
        newlyPersistedMessageUids.includes(messageUid),
    );
  const summarizedMessageUids = createSummaryMarker
    ? [
        ...new Set(
          normalizedSummaryCompletion.summarizedMessageIds
            .map((messageUid) => String(messageUid || "").trim())
            .filter(Boolean),
        ),
      ]
    : turnMessages.filter(isSummarized).map(resolveMessageUid).filter(Boolean);
  if (
    !createSummaryMarker ||
    !String(dialogProcessId || "").trim() ||
    !String(turnScopeId || "").trim() ||
    persistedMessageUids.length !== turnMessages.length ||
    !summarizedMessageUids.length
  ) {
    throw new Error("summary checkpoint requires canonical UIDs and complete active Turn identity");
  }
  const checkpointResult = await session.commitTurnSummaryCheckpoint({
    userId,
    sessionId,
    dialogProcessId,
    turnScopeId,
    parentSessionId,
    persistenceContext,
    checkpointId: buildCheckpointId({
      dialogProcessId,
      turnScopeId,
      persistedMessageUids,
      summarizedMessageUids,
      retainedMessageUids: [...retainedCheckpointEvidenceIds],
    }),
    expectedCheckpointRevision: runtime?.summaryCheckpointRevision,
    persistedMessageUids,
    summarizedMessageUids,
    retainedMessageUids: [...retainedCheckpointEvidenceIds],
  });
  const committedCheckpointRevision = Number(checkpointResult?.checkpointRevision);
  const markedCount = Number(checkpointResult?.markedCount) || 0;
  const committed = checkpointResult?.committed === true || checkpointResult?.deduplicated === true;
  if (!committed) {
    throw new Error("summary checkpoint transaction did not commit");
  }
  if (persistedMessageUids.length) {
    runtime.summaryCheckpointPersistedMessageUids = [
      ...new Set([
        ...(Array.isArray(runtime?.summaryCheckpointPersistedMessageUids)
          ? runtime.summaryCheckpointPersistedMessageUids
          : []),
        ...persistedMessageUids,
      ]),
    ];
  }
  if (Number.isFinite(committedCheckpointRevision)) {
    runtime.summaryCheckpointRevision = committedCheckpointRevision;
    if (runtime?.activeMessageContext && typeof runtime.activeMessageContext === "object") {
      runtime.activeMessageContext.checkpointRevision = committedCheckpointRevision;
    }
  }
  emitEvent(eventListener, "summary_checkpoint_committed", {
    source: String(normalizedSummaryCompletion?.source || "").trim(),
    requestedMessageCount: Array.isArray(normalizedSummaryCompletion?.summarizedMessageIds)
      ? normalizedSummaryCompletion.summarizedMessageIds.length
      : 0,
    turnMessageCount: turnMessages.length,
    summarizedMessageCount: summarizedMessageUids.length,
    persistedMessageCount: pendingMessages.length,
    markedMessageCount: Number(markedCount) || 0,
    preservedCheckpointEvidenceMessageUids: [...retainedCheckpointEvidenceIds].sort(),
    exactCheckpoint: true,
  });

  // The summary checkpoint is the commit boundary for deferred user_meta
  // projections. Apply each pending attachment result to its original
  // snapshot projection before summarized incremental messages are pruned.
  await applyPendingUserMetaBackwrites(runtime, {
    turnPersister,
    userId,
    sessionId,
    parentSessionId,
    dialogProcessId,
    turnScopeId,
    persistenceContext,
    eventListener,
  });

  const currentTurnMarker = createSummaryMarker();
  currentTurnMessages.updateWhere(
    { summarized: true },
    (message) => !isSummarized(message) && currentTurnMarker(message),
  );
  if (runtime?.activeMessageContext && typeof runtime.activeMessageContext === "object") {
    markMessagesSummarizedByIds(runtime.activeMessageContext, summarizedMessageUids);
  }
  const markedTurnMessages = currentTurnMessages.toArray();
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
