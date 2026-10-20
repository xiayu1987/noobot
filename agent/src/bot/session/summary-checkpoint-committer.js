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
import {
  resolveContextMessageId,
  resolveContextMessageSummarized,
} from "@noobot/context-protocol/message/codec";
import { text, isFunction, isObjectLike } from "@noobot/shared/value";

function createSummaryCompletionMarker(summaryCompletion = null) {
  if (!isObjectLike(summaryCompletion)) return null;
  if (!Array.isArray(summaryCompletion.summarizedMessageIds)) return null;
  const summarizedMessageIds = new Set(
    summaryCompletion.summarizedMessageIds.map((id) => text(id)).filter(Boolean),
  );
  return () => (message) => summarizedMessageIds.has(resolveContextMessageId(message));
}

function compactPromotionSource(message = {}) {
  const attachments = Array.isArray(message?.attachments) ? message.attachments : [];
  const transferEnvelopes = Array.isArray(message?.transferEnvelopes)
    ? message.transferEnvelopes
    : [];
  if (!attachments.length && !transferEnvelopes.length) return null;
  return {
    role: text(message?.role),
    type: text(message?.type),
    ...(attachments.length ? { attachments } : {}),
    ...(transferEnvelopes.length ? { transferEnvelopes } : {}),
  };
}

function resolveMessageUid(message = {}) {
  return text(message?.messageUid);
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

function hasActiveContext(runtime = null) {
  return Boolean(runtime?.activeMessageContext && typeof runtime.activeMessageContext === "object");
}

function arrayOrEmpty(value) {
  return Array.isArray(value) ? value : [];
}

function canCommitSummaryCheckpoint({ session, runtime, userId, sessionId } = {}) {
  const currentTurnMessages = runtime?.currentTurnMessages;
  if (!userId || !sessionId || !currentTurnMessages) return false;
  return (
    isFunction(currentTurnMessages.toArray) &&
    isFunction(currentTurnMessages.replaceAll) &&
    isFunction(session?.commitTurnSummaryCheckpoint)
  );
}

function resolveRetainedCheckpointEvidenceIds(turnMessages = []) {
  const summaryCallIndex = turnMessages.findLastIndex((message) =>
    hasCheckpointBoundaryToolCall(message),
  );
  const checkpointEvidenceScope =
    summaryCallIndex >= 0 ? turnMessages.slice(0, summaryCallIndex) : turnMessages;
  return new Set(
    [...collectLatestCheckpointEvidenceMessageIndexes(checkpointEvidenceScope)]
      .map((index) => resolveMessageUid(checkpointEvidenceScope[index]))
      .filter(Boolean),
  );
}

function normalizeSummaryCompletion(summaryCompletion = null, retainedIds = new Set()) {
  if (!isObjectLike(summaryCompletion)) return summaryCompletion;
  return {
    ...summaryCompletion,
    summarizedMessageIds: Array.isArray(summaryCompletion.summarizedMessageIds)
      ? summaryCompletion.summarizedMessageIds.filter((id) => !retainedIds.has(text(id)))
      : summaryCompletion.summarizedMessageIds,
  };
}

function resolveDurablyPersistedMessageUids(runtime = null) {
  return new Set(
    [
      ...arrayOrEmpty(runtime?.timelineCheckpointPersistedMessageUids),
      ...arrayOrEmpty(runtime?.summaryCheckpointPersistedMessageUids),
    ]
      .map((uid) => text(uid))
      .filter(Boolean),
  );
}

function resolvePendingCheckpointMessages({ turnMessages = [], runtime = null, durableUids } = {}) {
  if (turnMessages.every((message) => resolveMessageUid(message))) {
    return turnMessages.filter((message) => !durableUids.has(resolveMessageUid(message)));
  }
  const persistedPrefixCount = Math.min(
    turnMessages.length,
    Math.max(0, Number(runtime?.summaryCheckpointPersistedCount) || 0),
  );
  return turnMessages.slice(persistedPrefixCount);
}

async function persistPendingCheckpointMessages({
  pendingMessages = [],
  turnMessages = [],
  runtime,
  turnPersister,
  identity,
} = {}) {
  if (!pendingMessages.length) return;
  await turnPersister.appendAgentMessages({ ...identity, messages: pendingMessages });
  runtime.summaryCheckpointPersistedCount = turnMessages.length;
  runtime.summaryCheckpointPersistedTotal =
    Math.max(0, Number(runtime?.summaryCheckpointPersistedTotal) || 0) + pendingMessages.length;
}

function resolvePersistedMessageUids({
  turnMessages = [],
  pendingMessages = [],
  durableUids,
} = {}) {
  const newlyPersistedMessageUids = pendingMessages.map(resolveMessageUid).filter(Boolean);
  return turnMessages
    .map(resolveMessageUid)
    .filter(
      (messageUid) => durableUids.has(messageUid) || newlyPersistedMessageUids.includes(messageUid),
    );
}

function resolveSummarizedMessageUids({ hasMarker, completion, turnMessages = [] } = {}) {
  if (!hasMarker)
    return turnMessages
      .filter(resolveContextMessageSummarized)
      .map(resolveMessageUid)
      .filter(Boolean);
  return [
    ...new Set(
      completion.summarizedMessageIds.map((messageUid) => text(messageUid)).filter(Boolean),
    ),
  ];
}

function assertCheckpointScope({
  hasMarker,
  dialogProcessId,
  turnScopeId,
  persistedMessageUids,
  turnMessages,
  summarizedMessageUids,
} = {}) {
  const complete =
    hasMarker &&
    text(dialogProcessId) &&
    text(turnScopeId) &&
    persistedMessageUids.length === turnMessages.length &&
    summarizedMessageUids.length;
  if (!complete) {
    throw new Error("summary checkpoint requires canonical UIDs and complete active Turn identity");
  }
}

async function commitCheckpointTransaction({
  session,
  runtime,
  identity,
  persistedMessageUids,
  summarizedMessageUids,
  retainedMessageUids,
} = {}) {
  const { userId, sessionId, dialogProcessId, turnScopeId, persistenceScope } = identity;
  const checkpointResult = await session.commitTurnSummaryCheckpoint({
    userId,
    sessionId,
    dialogProcessId,
    turnScopeId,
    persistenceScope,
    checkpointId: buildCheckpointId({
      dialogProcessId,
      turnScopeId,
      persistedMessageUids,
      summarizedMessageUids,
      retainedMessageUids,
    }),
    expectedCheckpointRevision: runtime?.summaryCheckpointRevision,
    persistedMessageUids,
    summarizedMessageUids,
    retainedMessageUids,
  });
  if (checkpointResult?.committed !== true && checkpointResult?.deduplicated !== true) {
    throw new Error("summary checkpoint transaction did not commit");
  }
  return {
    checkpointRevision: Number(checkpointResult?.checkpointRevision),
    markedCount: Number(checkpointResult?.markedCount) || 0,
  };
}

function recordCommittedCheckpoint({
  runtime,
  persistedMessageUids = [],
  checkpointRevision,
} = {}) {
  if (persistedMessageUids.length) {
    runtime.summaryCheckpointPersistedMessageUids = [
      ...new Set([
        ...arrayOrEmpty(runtime?.summaryCheckpointPersistedMessageUids),
        ...persistedMessageUids,
      ]),
    ];
  }
  if (!Number.isFinite(checkpointRevision)) return;
  runtime.summaryCheckpointRevision = checkpointRevision;
  if (hasActiveContext(runtime)) {
    runtime.activeMessageContext.checkpointRevision = checkpointRevision;
  }
}

function applyCheckpointMarks({ runtime, createSummaryMarker, summarizedMessageUids } = {}) {
  const currentTurnMessages = runtime.currentTurnMessages;
  const currentTurnMarker = createSummaryMarker();
  currentTurnMessages.updateWhere(
    { summarized: true },
    (message) => !resolveContextMessageSummarized(message) && currentTurnMarker(message),
  );
  if (hasActiveContext(runtime)) {
    markMessagesSummarizedByIds(runtime.activeMessageContext, summarizedMessageUids);
  }
  const markedTurnMessages = currentTurnMessages.toArray();
  const retainedMessages = markedTurnMessages.filter(
    (message) => !resolveContextMessageSummarized(message),
  );
  const promotionSources = markedTurnMessages
    .filter(resolveContextMessageSummarized)
    .map(compactPromotionSource)
    .filter(Boolean);
  if (promotionSources.length) {
    runtime.summaryCheckpointPromotionSources = [
      ...arrayOrEmpty(runtime?.summaryCheckpointPromotionSources),
      ...promotionSources,
    ];
  }
  currentTurnMessages.replaceAll(retainedMessages);
  if (hasActiveContext(runtime)) {
    pruneSummarizedIncrementalMessages(runtime.activeMessageContext);
  }
  runtime.summaryCheckpointPersistedCount = retainedMessages.length;
}

export async function commitSummaryCheckpoint({
  session = null,
  turnPersister = null,
  runtime = null,
  userId = "",
  sessionId = "",
  dialogProcessId = "",
  parentDialogProcessId = "",
  turnScopeId = "",
  eventListener = null,
  persistenceScope,
  summaryCompletion = null,
} = {}) {
  if (!canCommitSummaryCheckpoint({ session, runtime, userId, sessionId })) {
    return { committed: false, persistedCount: 0, markedCount: 0 };
  }
  const identity = {
    userId,
    sessionId,
    dialogProcessId,
    parentDialogProcessId,
    turnScopeId,
    eventListener,
    persistenceScope,
  };
  const turnMessages = runtime.currentTurnMessages.toArray();
  const retainedCheckpointEvidenceIds = resolveRetainedCheckpointEvidenceIds(turnMessages);
  const completion = normalizeSummaryCompletion(summaryCompletion, retainedCheckpointEvidenceIds);
  const createSummaryMarker = createSummaryCompletionMarker(completion);
  const durableUids = resolveDurablyPersistedMessageUids(runtime);
  const pendingMessages = resolvePendingCheckpointMessages({ turnMessages, runtime, durableUids });
  await persistPendingCheckpointMessages({
    pendingMessages,
    turnMessages,
    runtime,
    turnPersister,
    identity,
  });

  const persistedMessageUids = resolvePersistedMessageUids({
    turnMessages,
    pendingMessages,
    durableUids,
  });
  const hasMarker = Boolean(createSummaryMarker);
  const summarizedMessageUids = resolveSummarizedMessageUids({
    hasMarker,
    completion,
    turnMessages,
  });
  assertCheckpointScope({
    hasMarker,
    dialogProcessId,
    turnScopeId,
    persistedMessageUids,
    turnMessages,
    summarizedMessageUids,
  });
  const retainedMessageUids = [...retainedCheckpointEvidenceIds];
  const { checkpointRevision, markedCount } = await commitCheckpointTransaction({
    session,
    runtime,
    identity,
    persistedMessageUids,
    summarizedMessageUids,
    retainedMessageUids,
  });
  recordCommittedCheckpoint({ runtime, persistedMessageUids, checkpointRevision });
  emitEvent(eventListener, "summary_checkpoint_committed", {
    source: text(completion?.source),
    requestedMessageCount: Array.isArray(completion?.summarizedMessageIds)
      ? completion.summarizedMessageIds.length
      : 0,
    turnMessageCount: turnMessages.length,
    summarizedMessageCount: summarizedMessageUids.length,
    persistedMessageCount: pendingMessages.length,
    markedMessageCount: markedCount,
    preservedCheckpointEvidenceMessageUids: [...retainedCheckpointEvidenceIds].sort(),
    exactCheckpoint: true,
  });

  await applyPendingUserMetaBackwrites(runtime, {
    turnPersister,
    userId,
    sessionId,
    dialogProcessId,
    turnScopeId,
    persistenceScope,
    eventListener,
  });
  applyCheckpointMarks({ runtime, createSummaryMarker, summarizedMessageUids });
  return {
    committed: true,
    persistedCount: pendingMessages.length,
    markedCount,
  };
}
