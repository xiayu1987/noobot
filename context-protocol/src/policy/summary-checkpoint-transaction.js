/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

import {
  SESSION_ERROR_CODE,
  resolveSessionMessageRecordDialogProcessId,
} from "@noobot/session-protocol";
import {
  resolveContextToolCallDeclarationId,
  resolveContextToolResultCallId,
  resolveContextToolCalls,
} from "../message/codec.js";
import {
  appendTurnSummaryCheckpointReceipt,
  readTurnSummaryCheckpointState,
  writeTurnSummaryCheckpoints,
} from "./summary.js";
import {
  assertSummaryCheckpointDisposition,
  assertSummaryCheckpointTargetsTurn,
  assertSummaryCheckpointTurnOwnership,
} from "./summary-checkpoint-request.js";

function checkpointConflict(message, code) {
  const error = new Error(message);
  error.code = code;
  error.statusCode = 409;
  return error;
}

export function summaryCheckpointEffectMessageUids(receipt) {
  return new Set([...receipt.persistedMessageUids, ...receipt.summarizedMessageUids]);
}

export function summaryCheckpointToolPairMemberships(message) {
  const pairs = new Map();
  if (!message) return pairs;
  const dialogProcessId = resolveSessionMessageRecordDialogProcessId(message);
  const key = (id) => JSON.stringify([dialogProcessId, message.turnScopeId, id]);
  for (const call of resolveContextToolCalls(message)) {
    const id = resolveContextToolCallDeclarationId(call);
    if (id) pairs.set(key(id), "declaration");
  }
  const result = resolveContextToolResultCallId(message);
  if (result) pairs.set(key(result), "result");
  return pairs;
}

export function assertSummaryCheckpointToolPairSelection(key, pair, selectedCount) {
  if (!pair.ownerUid || selectedCount === 0 || selectedCount === pair.resultCount + 1) return;
  throw checkpointConflict(
    `summary checkpoint splits tool call pair: ${JSON.parse(key)[2]}`,
    SESSION_ERROR_CODE.TURN_SUMMARY_CHECKPOINT_TOOL_PAIR_SPLIT,
  );
}

function collectToolPairMemberships(pairs, message, selected) {
  for (const [key, role] of summaryCheckpointToolPairMemberships(message)) {
    const pair = pairs.get(key) ?? { ownerUid: "", resultCount: 0, selectedCount: 0 };
    if (role === "declaration") pair.ownerUid = message.messageUid;
    else pair.resultCount += 1;
    if (selected) pair.selectedCount += 1;
    pairs.set(key, pair);
  }
}

function assertSummarizedToolPairClosure(messages, summarizedMessageUids) {
  const summarizedSet = new Set(summarizedMessageUids);
  const pairs = new Map();
  for (const message of messages)
    collectToolPairMemberships(pairs, message, summarizedSet.has(message.messageUid));
  for (const [key, pair] of pairs)
    assertSummaryCheckpointToolPairSelection(key, pair, pair.selectedCount);
}

function resolveDuplicateCheckpoint(currentState, request) {
  const existingReceipt = currentState.receipts.find(
    (receipt) => receipt.checkpointId === request.checkpointId,
  );
  if (!existingReceipt) return null;
  if (
    existingReceipt.requestHash !== request.requestHash ||
    existingReceipt.checkpointRevision - 1 !== request.expectedCheckpointRevision
  ) {
    throw checkpointConflict(
      "checkpointId was reused with a different payload or predecessor",
      SESSION_ERROR_CODE.TURN_SUMMARY_CHECKPOINT_ID_REUSED,
    );
  }
  return {
    committed: false,
    deduplicated: true,
    reason: "duplicate_checkpoint",
    markedCount: existingReceipt.markedCount,
    checkpointRevision: existingReceipt.checkpointRevision,
    receipt: existingReceipt,
  };
}

function assertCheckpointRevision(currentRevision, request) {
  if (request.expectedCheckpointRevision === currentRevision) return;
  const error = checkpointConflict(
    "turn summary checkpoint revision conflict",
    SESSION_ERROR_CODE.TURN_SUMMARY_CHECKPOINT_REVISION_CONFLICT,
  );
  error.currentCheckpointRevision = currentRevision;
  throw error;
}

function assertCheckpointMessagesResolved(messages, request) {
  const requestedUids = new Set([
    ...request.persistedMessageUids,
    ...request.summarizedMessageUids,
    ...request.retainedMessageUids,
  ]);
  const messagesByUid = new Map();
  for (const message of messages) {
    if (requestedUids.has(message.messageUid)) messagesByUid.set(message.messageUid, message);
  }
  const unresolvedMessageUids = [...requestedUids].filter(
    (messageUid) => !messagesByUid.has(messageUid),
  );
  if (unresolvedMessageUids.length) {
    const error = checkpointConflict(
      `checkpoint contains ${unresolvedMessageUids.length} missing message UIDs`,
      SESSION_ERROR_CODE.TURN_SUMMARY_CHECKPOINT_MESSAGE_MISSING,
    );
    error.messageUidResolution = {
      requestedMessageUids: [...requestedUids],
      resolvedMessageUids: [...messagesByUid.keys()],
      unresolvedMessageUids,
    };
    throw error;
  }
  for (const messageUid of request.persistedMessageUids) {
    const message = messagesByUid.get(messageUid);
    if (
      resolveSessionMessageRecordDialogProcessId(message) !== request.dialogProcessId ||
      message.turnScopeId !== request.turnScopeId
    ) {
      throw checkpointConflict(
        `persisted checkpoint message is outside the current turn: ${messageUid}`,
        SESSION_ERROR_CODE.TURN_SUMMARY_CHECKPOINT_MESSAGE_SCOPE_CONFLICT,
      );
    }
  }
}

function markCheckpointMessages(messages, request) {
  const summarizedSet = new Set(request.summarizedMessageUids);
  const retainedSet = new Set(request.retainedMessageUids);
  let markedCount = 0;
  const nextMessages = messages.map((message) => {
    if (summarizedSet.has(message.messageUid)) {
      if (message.summarized === true) return message;
      markedCount += 1;
      return { ...message, summarized: true };
    }
    if (retainedSet.has(message.messageUid) && message.summarized === true) {
      return { ...message, summarized: false };
    }
    return message;
  });
  return { nextMessages, markedCount };
}

export function applyTurnSummaryCheckpoint(session, request, committedAt) {
  const prepared = prepareCheckpoint(session, request);
  if (prepared.duplicate) return prepared.duplicate;
  assertSummarizedToolPairClosure(session.messages, request.summarizedMessageUids);
  return commitCheckpoint(session, request, committedAt, prepared.currentState);
}

export async function applyIndexedTurnSummaryCheckpoint(session, request, committedAt, readPairs) {
  const prepared = prepareCheckpoint(session, request);
  if (prepared.duplicate) return prepared.duplicate;
  const selected = new Set(request.summarizedMessageUids);
  const counts = new Map();
  for (const message of session.messages) {
    if (!selected.has(message.messageUid)) continue;
    for (const key of summaryCheckpointToolPairMemberships(message).keys())
      counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  if (counts.size) {
    const pairs = await readPairs([...counts.keys()]);
    for (const [key, count] of counts)
      assertSummaryCheckpointToolPairSelection(key, pairs.get(key), count);
  }
  return commitCheckpoint(session, request, committedAt, prepared.currentState);
}

function prepareCheckpoint(session, request) {
  assertSummaryCheckpointTurnOwnership(session, request);
  const currentState = readTurnSummaryCheckpointState(session, request);
  const duplicate = resolveDuplicateCheckpoint(currentState, request);
  if (duplicate) return { duplicate };
  assertSummaryCheckpointTargetsTurn(session, request);
  assertCheckpointRevision(currentState.checkpointRevision, request);
  assertSummaryCheckpointDisposition(request);
  assertCheckpointMessagesResolved(session.messages, request);
  return { currentState };
}

function commitCheckpoint(session, request, committedAt, currentState) {
  const { nextMessages, markedCount } = markCheckpointMessages(session.messages, request);
  const checkpointRevision = currentState.checkpointRevision + 1;
  const receipt = {
    checkpointId: request.checkpointId,
    checkpointRevision,
    requestHash: request.requestHash,
    persistedMessageUids: request.persistedMessageUids,
    summarizedMessageUids: request.summarizedMessageUids,
    retainedMessageUids: request.retainedMessageUids,
    markedCount,
    committedAt,
  };
  const nextCheckpointState = appendTurnSummaryCheckpointReceipt(currentState, receipt);
  writeTurnSummaryCheckpoints(session, {
    ...session.turnSummaryCheckpoints,
    [request.turnScopeId]: nextCheckpointState,
  });
  session.messages = nextMessages;
  session.updatedAt = committedAt;
  return { committed: true, markedCount, checkpointRevision, receipt };
}
