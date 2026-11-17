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
import { applyPendingUserMetaBackwrites } from "../../context/assembly/message-builder/user-meta-backwrite.js";
import { readSessionMessageDraftAttachments } from "@noobot/session-protocol";
import { normalizeTransferEnvelopes } from "@noobot/semantic-transfer-protocol";
import { requireActiveModelContext } from "../../runtime/active-model-context.js";
import {
  createSessionChangesSubmission,
  projectMessagePersistenceChanges,
} from "@noobot/session-protocol/session-changes";

const checkpointTransactions = new WeakMap();

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

function excludeRetainedSummaryTargets(summaryCompletion, retainedUids) {
  return {
    ...summaryCompletion,
    summarizedMessageUids: summaryCompletion.summarizedMessageUids.filter(
      (messageUid) => !retainedUids.has(messageUid),
    ),
  };
}

async function commitCheckpointTransaction({
  session,
  expectedCheckpointRevision,
  identity,
  messages,
  messageContentAppends,
  messageMetadataUpdates,
  submission,
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
    messages,
    messageContentAppends,
    messageMetadataUpdates,
    submission,
    checkpointId: createSummaryCheckpointId({
      dialogProcessId,
      turnScopeId,
      expectedCheckpointRevision,
      persistedMessageUids,
      summarizedMessageUids,
      retainedMessageUids,
      messages,
      messageContentAppends,
      messageMetadataUpdates,
    }),
    expectedCheckpointRevision,
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
  return { checkpointRevision, markedCount, messageReceipts: checkpointResult.messageReceipts };
}

function recordCommittedCheckpoint({ runtime, checkpointRevision }) {
  if (checkpointRevision === runtime.summaryCheckpointRevision) return;
  advanceContextCheckpointRevision(requireActiveModelContext(runtime), checkpointRevision);
  runtime.summaryCheckpointRevision = checkpointRevision;
}

function applyCheckpointMarks({ runtime, summarizedMessageUids }) {
  const currentTurnMessages = runtime.currentTurnMessages;
  markMessagesSummarizedByIds(requireActiveModelContext(runtime), summarizedMessageUids);
  for (const message of currentTurnMessages.evictCommittedByUids(summarizedMessageUids)) {
    const promotionSource = compactPromotionSource(message);
    if (promotionSource) runtime.summaryCheckpointPromotionSources.push(promotionSource);
  }
  pruneSummarizedIncrementalMessages(requireActiveModelContext(runtime));
}

function prepareCheckpointTransaction({ runtime, turnPersister, identity, summaryCompletion }) {
  const { dialogProcessId, turnScopeId } = identity;
  const store = runtime.currentTurnMessages;
  const retainedCheckpointEvidenceIds = new Set(store.readCheckpointEvidenceUids());
  const completion = excludeRetainedSummaryTargets(
    summaryCompletion,
    retainedCheckpointEvidenceIds,
  );
  const { entries } = store.readPendingChanges();
  const pendingMessages = entries.map((entry) => entry.message);
  const workingSet = new Map(pendingMessages.map((message) => [message.messageUid, message]));
  for (const uid of retainedCheckpointEvidenceIds) {
    if (!workingSet.has(uid)) workingSet.set(uid, store.readByUid(uid));
  }
  const checkpointMessages = [...workingSet.values()];
  const persistedMessageUids = checkpointMessages.map(resolveMessageUid);
  const { summarizedMessageUids } = completion;
  assertSummaryCheckpointSource({
    dialogProcessId,
    turnScopeId,
    persistedMessageUids,
    checkpointMessages,
    summarizedMessageUids,
  });
  const changes = projectMessagePersistenceChanges(pendingMessages, entries, identity);
  const { messages, messageContentAppends, messageMetadataUpdates } = structuredClone({
    ...changes,
    messages: turnPersister.prepareAgentMessages({ ...identity, messages: changes.messages }),
  });
  const retainedMessageUids = [...retainedCheckpointEvidenceIds];
  const summarizedRevisions = store.readMessageRevisions(summarizedMessageUids);
  return {
    runtime,
    entries,
    summarizedRevisions,
    expectedCheckpointRevision: runtime.summaryCheckpointRevision,
    identity,
    messages,
    messageContentAppends,
    messageMetadataUpdates,
    submission: createSessionChangesSubmission(),
    persistedMessageUids,
    summarizedMessageUids,
    retainedMessageUids,
    result: null,
    completed: false,
  };
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
  if (!checkpointTransactions.has(summaryCompletion)) {
    checkpointTransactions.set(
      summaryCompletion,
      prepareCheckpointTransaction({
        runtime,
        turnPersister,
        identity,
        summaryCompletion,
      }),
    );
  }
  const transaction = checkpointTransactions.get(summaryCompletion);
  if (transaction.runtime !== runtime)
    throw new Error("checkpoint instruction belongs to another runtime");
  if (transaction.result === null) {
    transaction.result = await commitCheckpointTransaction({ session, ...transaction });
  }
  const { checkpointRevision, markedCount, messageReceipts } = transaction.result;
  const result = { committed: true, persistedCount: transaction.entries.length, markedCount };
  if (transaction.completed) return result;
  const { entries, summarizedRevisions, summarizedMessageUids, retainedMessageUids } = transaction;
  const store = runtime.currentTurnMessages;
  if (!Array.isArray(messageReceipts))
    throw new TypeError("Summary checkpoint requires message persistence receipts");
  if (messageReceipts.some((receipt) => receipt.sessionId !== identity.sessionId))
    throw new TypeError("Summary checkpoint receipt session ownership mismatch");
  store.confirmPersistence(entries, messageReceipts);
  store.acknowledgeChanges(entries);
  recordCommittedCheckpoint({ runtime, checkpointRevision });
  await applyPendingUserMetaBackwrites(runtime, {
    session,
    userId,
    sessionId,
    persistenceScope,
  });
  applyCheckpointMarks({
    runtime,
    summarizedMessageUids: store.readUnchangedMessageUids(summarizedRevisions),
  });
  await emitEvent(eventListener, "summary_checkpoint_committed", {
    source: summaryCompletion.source,
    requestedMessageCount: summaryCompletion.summarizedMessageUids.length,
    turnMessageCount: store.readCounts().messageCount,
    summarizedMessageCount: summarizedMessageUids.length,
    persistedMessageCount: transaction.entries.length,
    markedMessageCount: markedCount,
    preservedCheckpointEvidenceMessageUids: [...retainedMessageUids].sort(),
    exactCheckpoint: true,
  });
  transaction.completed = true;
  return result;
}
