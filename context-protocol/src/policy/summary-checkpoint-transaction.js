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
} from "./summary-checkpoint-request.js";

function checkpointConflict(message, code) {
  const error = new Error(message);
  error.code = code;
  error.statusCode = 409;
  return error;
}

function toolPairKey(message, callId) {
  return [resolveSessionMessageRecordDialogProcessId(message), message.turnScopeId, callId].join(
    "\u0000",
  );
}

function assertSummarizedToolPairClosure(messages, summarizedMessageUids) {
  const summarizedSet = new Set(summarizedMessageUids);
  const callOwnerById = new Map();
  const resultUidsByCallId = new Map();
  for (const message of messages) {
    const messageUid = message.messageUid;
    for (const call of resolveContextToolCalls(message)) {
      const callId = resolveContextToolCallDeclarationId(call);
      if (callId) callOwnerById.set(toolPairKey(message, callId), messageUid);
    }
    const resultCallId = resolveContextToolResultCallId(message);
    if (!resultCallId) continue;
    const pairKey = toolPairKey(message, resultCallId);
    if (!resultUidsByCallId.has(pairKey)) resultUidsByCallId.set(pairKey, []);
    resultUidsByCallId.get(pairKey).push(messageUid);
  }
  for (const [pairKey, ownerUid] of callOwnerById) {
    const pairUids = [ownerUid, ...(resultUidsByCallId.get(pairKey) ?? [])];
    const selectedCount = pairUids.filter((messageUid) => summarizedSet.has(messageUid)).length;
    if (selectedCount === 0 || selectedCount === pairUids.length) continue;
    const callId = pairKey.slice(pairKey.lastIndexOf("\u0000") + 1);
    throw checkpointConflict(
      `summary checkpoint splits tool call pair: ${callId}`,
      SESSION_ERROR_CODE.TURN_SUMMARY_CHECKPOINT_TOOL_PAIR_SPLIT,
    );
  }
}

function resolveDuplicateCheckpoint(currentState, request) {
  const existingReceipt = currentState.receipts.find(
    (receipt) => receipt.checkpointId === request.checkpointId,
  );
  if (!existingReceipt) return null;
  if (existingReceipt.requestHash !== request.requestHash) {
    throw checkpointConflict(
      "checkpointId was reused with a different payload",
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
  assertSummaryCheckpointTargetsTurn(session, request);
  const currentState = readTurnSummaryCheckpointState(session, request);
  const duplicate = resolveDuplicateCheckpoint(currentState, request);
  if (duplicate) return duplicate;
  assertCheckpointRevision(currentState.checkpointRevision, request);
  assertSummaryCheckpointDisposition(request);
  assertCheckpointMessagesResolved(session.messages, request);
  assertSummarizedToolPairClosure(session.messages, request.summarizedMessageUids);
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
