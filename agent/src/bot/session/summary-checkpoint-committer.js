/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

import {
  advanceContextCheckpointRevision,
  markContextMessagesSummarized as markMessagesSummarizedByIds,
  pruneContextSummarizedIncremental as pruneSummarizedIncrementalMessages,
} from "@noobot/context-protocol/mutation/context";
import {
  assertSummaryCheckpointSource,
  createSummaryCheckpointId,
} from "@noobot/context-protocol/policy/summary-checkpoint-request";
import { MAIN_FLOW_CONTROL_ACTION } from "@noobot/context-protocol/policy/main-flow-control";
import { emitEvent } from "../../events/index.js";
import {
  collectLatestCheckpointEvidenceMessageIndexes,
  hasCheckpointBoundaryToolCall,
} from "@noobot/context-protocol/policy/summary";
import { applyPendingUserMetaBackwrites } from "../../context/assembly/message-builder/user-meta-backwrite.js";
import { projectSessionRecordToContextMessage } from "@noobot/context-protocol/message/session-projection";
import {
  isSummarizedSessionMessageRecord,
  readSessionMessageDraftAttachments,
} from "@noobot/session-protocol";
import { normalizeTransferEnvelopes } from "@noobot/semantic-transfer-protocol";
import { requireActiveModelContext } from "../../runtime/active-model-context.js";

function assertSummaryCheckpointInstruction(summaryCompletion) {
  if (summaryCompletion?.action !== MAIN_FLOW_CONTROL_ACTION.SUMMARY_CHECKPOINT) {
    throw new TypeError("summary checkpoint requires a summary checkpoint instruction");
  }
  return summaryCompletion;
}

function compactPromotionSource(message) {
  const attachments = readSessionMessageDraftAttachments(message);
  const transferEnvelopes = normalizeTransferEnvelopes(message.transferEnvelopes);
  if (!attachments.length && !transferEnvelopes.length) return null;
  return {
    role: message.role,
    ...(message.type === undefined ? {} : { type: message.type }),
    ...(attachments.length ? { attachments } : {}),
    ...(transferEnvelopes.length ? { transferEnvelopes } : {}),
  };
}

function resolveMessageUid(message) {
  return message.messageUid;
}

function resolveRetainedCheckpointEvidenceIds(turnMessages) {
  const contextMessages = turnMessages.map(projectSessionRecordToContextMessage);
  const summaryCallIndex = contextMessages.findLastIndex((message) =>
    hasCheckpointBoundaryToolCall(message),
  );
  const checkpointEvidenceScope =
    summaryCallIndex >= 0 ? turnMessages.slice(0, summaryCallIndex) : turnMessages;
  const checkpointEvidenceContext =
    summaryCallIndex >= 0 ? contextMessages.slice(0, summaryCallIndex) : contextMessages;
  return new Set(
    [...collectLatestCheckpointEvidenceMessageIndexes(checkpointEvidenceContext)].map((index) =>
      resolveMessageUid(checkpointEvidenceScope[index]),
    ),
  );
}

function excludeRetainedSummaryTargets(summaryCompletion, retainedUids) {
  return {
    ...summaryCompletion,
    summarizedMessageUids: summaryCompletion.summarizedMessageUids.filter(
      (messageUid) => !retainedUids.has(messageUid),
    ),
  };
}

function resolveDurablyPersistedMessageUids(runtime) {
  return new Set([
    ...runtime.timelineCheckpointPersistedMessageUids,
    ...runtime.summaryCheckpointPersistedMessageUids,
  ]);
}

function resolvePendingCheckpointMessages({ turnMessages, durableUids }) {
  return turnMessages.filter((message) => !durableUids.has(resolveMessageUid(message)));
}

async function persistPendingCheckpointMessages({ pendingMessages, turnPersister, identity }) {
  if (!pendingMessages.length) return;
  await turnPersister.appendAgentMessages({ ...identity, messages: pendingMessages });
}

async function commitCheckpointTransaction({
  session,
  runtime,
  identity,
  persistedMessageUids,
  summarizedMessageUids,
  retainedMessageUids,
}) {
  const { userId, sessionId, dialogProcessId, turnScopeId, persistenceScope } = identity;
  const checkpointResult = await session.commitTurnSummaryCheckpoint({
    userId,
    sessionId,
    dialogProcessId,
    turnScopeId,
    persistenceScope,
    checkpointId: createSummaryCheckpointId({
      dialogProcessId,
      turnScopeId,
      persistedMessageUids,
      summarizedMessageUids,
      retainedMessageUids,
    }),
    expectedCheckpointRevision: runtime.summaryCheckpointRevision,
    persistedMessageUids,
    summarizedMessageUids,
    retainedMessageUids,
  });
  if (checkpointResult?.committed !== true && checkpointResult?.deduplicated !== true) {
    throw new Error("summary checkpoint transaction did not commit");
  }
  const { checkpointRevision, markedCount } = checkpointResult;
  if (!Number.isInteger(checkpointRevision) || !Number.isInteger(markedCount)) {
    throw new TypeError(
      "summary checkpoint result requires integer checkpointRevision and markedCount",
    );
  }
  return { checkpointRevision, markedCount };
}

function recordCommittedCheckpoint({ runtime, persistedMessageUids, checkpointRevision }) {
  if (persistedMessageUids.length) {
    runtime.summaryCheckpointPersistedMessageUids = [
      ...new Set([...runtime.summaryCheckpointPersistedMessageUids, ...persistedMessageUids]),
    ];
  }
  if (checkpointRevision === runtime.summaryCheckpointRevision) return;
  advanceContextCheckpointRevision(requireActiveModelContext(runtime), checkpointRevision);
  runtime.summaryCheckpointRevision = checkpointRevision;
}

function applyCheckpointMarks({ runtime, summarizedMessageUids }) {
  const currentTurnMessages = runtime.currentTurnMessages;
  const summarizedSet = new Set(summarizedMessageUids);
  currentTurnMessages.updateWhere(
    { summarized: true },
    (message) =>
      !isSummarizedSessionMessageRecord(message) && summarizedSet.has(resolveMessageUid(message)),
  );
  markMessagesSummarizedByIds(requireActiveModelContext(runtime), summarizedMessageUids);
  const markedTurnMessages = currentTurnMessages.toArray();
  const retainedMessages = markedTurnMessages.filter(
    (message) => !isSummarizedSessionMessageRecord(message),
  );
  const promotionSources = markedTurnMessages
    .filter(isSummarizedSessionMessageRecord)
    .map(compactPromotionSource)
    .filter(Boolean);
  if (promotionSources.length) {
    runtime.summaryCheckpointPromotionSources = [
      ...runtime.summaryCheckpointPromotionSources,
      ...promotionSources,
    ];
  }
  currentTurnMessages.replaceAll(retainedMessages);
  pruneSummarizedIncrementalMessages(requireActiveModelContext(runtime));
}

export async function commitSummaryCheckpoint({
  session,
  turnPersister,
  runtime,
  userId,
  sessionId,
  dialogProcessId,
  parentDialogProcessId,
  turnScopeId,
  eventListener,
  persistenceScope,
  summaryCompletion,
}) {
  assertSummaryCheckpointInstruction(summaryCompletion);
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
  const completion = excludeRetainedSummaryTargets(
    summaryCompletion,
    retainedCheckpointEvidenceIds,
  );
  const durableUids = resolveDurablyPersistedMessageUids(runtime);
  const pendingMessages = resolvePendingCheckpointMessages({ turnMessages, durableUids });
  const persistedMessageUids = turnMessages.map(resolveMessageUid);
  const { summarizedMessageUids } = completion;
  assertSummaryCheckpointSource({
    dialogProcessId,
    turnScopeId,
    persistedMessageUids,
    turnMessages,
    summarizedMessageUids,
  });
  await persistPendingCheckpointMessages({ pendingMessages, turnPersister, identity });
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
    source: completion.source,
    requestedMessageCount: summaryCompletion.summarizedMessageUids.length,
    turnMessageCount: turnMessages.length,
    summarizedMessageCount: summarizedMessageUids.length,
    persistedMessageCount: pendingMessages.length,
    markedMessageCount: markedCount,
    preservedCheckpointEvidenceMessageUids: [...retainedCheckpointEvidenceIds].sort(),
    exactCheckpoint: true,
  });

  await applyPendingUserMetaBackwrites(runtime, {
    session,
    userId,
    sessionId,
    persistenceScope,
  });
  applyCheckpointMarks({ runtime, summarizedMessageUids });
  return {
    committed: true,
    persistedCount: pendingMessages.length,
    markedCount,
  };
}
