/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import {
  SESSION_ERROR_CODE,
  createSessionNotFoundError,
  normalizeDialogProcessId,
  requireDialogProcessKey,
  resolveSessionMessageRecordDialogProcessId,
} from "@noobot/session-protocol";
import { requireCanonicalTurnScopeId } from "@noobot/session-protocol/turn-scope-identity";
import {
  resolveContextToolCallDeclarationId,
  resolveContextToolResultCallId,
  resolveContextToolCalls,
} from "@noobot/context-protocol/message/codec";
import {
  appendTurnSummaryCheckpointReceipt,
  readTurnSummaryCheckpointState,
  writeTurnSummaryCheckpoints,
} from "@noobot/context-protocol/policy/summary";
import { createHash } from "node:crypto";
import { isTerminalTurnLifecycleState } from "@noobot/authoritative-state/domain";
import { text } from "@noobot/shared/value";

function invalidCheckpointRequest(detail) {
  const error = new TypeError(`invalid turn summary checkpoint request: ${detail}`);
  error.code = SESSION_ERROR_CODE.TURN_SUMMARY_CHECKPOINT_REQUEST_INVALID;
  error.statusCode = 400;
  return error;
}

function requireRequestText(value, field) {
  if (typeof value !== "string" || !value || value !== value.trim()) {
    throw invalidCheckpointRequest(`${field} must be a non-empty trimmed string`);
  }
  return value;
}

function requireRequestMessageUids(values, field) {
  if (!Array.isArray(values)) throw invalidCheckpointRequest(`${field} must be an array`);
  values.forEach((uid) => requireRequestText(uid, `${field}[]`));
  if (new Set(values).size !== values.length) {
    throw invalidCheckpointRequest(`${field} must not contain duplicates`);
  }
  return values;
}

function checkpointRequestHash({
  dialogProcessId,
  turnScopeId,
  persistedMessageUids,
  summarizedMessageUids,
  retainedMessageUids,
}) {
  return `sha256:${createHash("sha256")
    .update(
      JSON.stringify({
        dialogProcessId,
        turnScopeId,
        persistedMessageUids,
        summarizedMessageUids,
        retainedMessageUids,
      }),
    )
    .digest("hex")}`;
}

function checkpointConflict(message, code) {
  const error = new Error(message);
  error.code = code;
  error.statusCode = 409;
  return error;
}

function toolPairKey(message = {}, callId = "") {
  return [
    resolveSessionMessageRecordDialogProcessId(message),
    text(message?.turnScopeId),
    text(callId),
  ].join("\u0000");
}

function assertSummarizedToolPairClosure(messages = [], summarizedMessageUids = []) {
  const summarizedSet = new Set(summarizedMessageUids);
  const callOwnerById = new Map();
  const resultUidsByCallId = new Map();
  for (const message of messages) {
    const messageUid = text(message?.messageUid);
    if (!messageUid) continue;
    for (const call of resolveContextToolCalls(message)) {
      const callId = resolveContextToolCallDeclarationId(call);
      if (callId) callOwnerById.set(toolPairKey(message, callId), messageUid);
    }
    const resultCallId = resolveContextToolResultCallId(message);
    if (!resultCallId) continue;
    const pairKey = toolPairKey(message, resultCallId);
    const resultUids = resultUidsByCallId.get(pairKey) || [];
    resultUids.push(messageUid);
    resultUidsByCallId.set(pairKey, resultUids);
  }
  for (const [pairKey, ownerUid] of callOwnerById.entries()) {
    const pairUids = [ownerUid, ...(resultUidsByCallId.get(pairKey) || [])];
    const selectedCount = pairUids.filter((messageUid) => summarizedSet.has(messageUid)).length;
    if (selectedCount === 0 || selectedCount === pairUids.length) continue;
    const callId = pairKey.slice(pairKey.lastIndexOf("\u0000") + 1);
    throw checkpointConflict(
      `summary checkpoint splits tool call pair: ${callId}`,
      SESSION_ERROR_CODE.TURN_SUMMARY_CHECKPOINT_TOOL_PAIR_SPLIT,
    );
  }
}

function parseCheckpointRequest(payload) {
  if (!Number.isInteger(payload.expectedCheckpointRevision)) {
    throw invalidCheckpointRequest("expectedCheckpointRevision must be an integer");
  }
  const request = {
    userId: requireRequestText(payload.userId, "userId"),
    sessionId: requireRequestText(payload.sessionId, "sessionId"),
    persistenceContext: payload.persistenceContext,
    dialogProcessId: requireDialogProcessKey(payload.dialogProcessId),
    turnScopeId: requireCanonicalTurnScopeId(payload.turnScopeId),
    checkpointId: requireRequestText(payload.checkpointId, "checkpointId"),
    expectedCheckpointRevision: payload.expectedCheckpointRevision,
    persistedMessageUids: requireRequestMessageUids(
      payload.persistedMessageUids,
      "persistedMessageUids",
    ),
    summarizedMessageUids: requireRequestMessageUids(
      payload.summarizedMessageUids,
      "summarizedMessageUids",
    ),
    retainedMessageUids: requireRequestMessageUids(
      payload.retainedMessageUids,
      "retainedMessageUids",
    ),
  };
  request.requestHash = checkpointRequestHash(request);
  return request;
}

function assertCheckpointTargetsTurn(session, request) {
  const lifecycle = session.turnLifecycle;
  const lifecycleTurn = lifecycle.turns?.[request.turnScopeId];
  if (lifecycleTurn) {
    if (normalizeDialogProcessId(lifecycleTurn?.dialogProcessId) !== request.dialogProcessId) {
      throw checkpointConflict(
        "checkpoint does not own the lifecycle turn",
        SESSION_ERROR_CODE.TURN_SUMMARY_CHECKPOINT_OWNERSHIP_CONFLICT,
      );
    }
    if (isTerminalTurnLifecycleState(lifecycleTurn.state) && request.persistedMessageUids.length) {
      throw checkpointConflict(
        "terminal checkpoint cannot persist additional messages",
        SESSION_ERROR_CODE.TURN_SUMMARY_CHECKPOINT_TERMINAL_PERSISTENCE,
      );
    }
  }
  const activeTurnScopeId = text(lifecycle.activeTurnScopeId);
  if (activeTurnScopeId && activeTurnScopeId !== request.turnScopeId) {
    throw checkpointConflict(
      "checkpoint does not target the active turn",
      SESSION_ERROR_CODE.TURN_SUMMARY_CHECKPOINT_NOT_ACTIVE,
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

function assertCheckpointDisposition(request) {
  const summarizedSet = new Set(request.summarizedMessageUids);
  if (request.retainedMessageUids.some((messageUid) => summarizedSet.has(messageUid))) {
    throw checkpointConflict(
      "checkpoint cannot summarize and retain the same message",
      SESSION_ERROR_CODE.TURN_SUMMARY_CHECKPOINT_DISPOSITION_CONFLICT,
    );
  }
  const persistedSet = new Set(request.persistedMessageUids);
  if (request.retainedMessageUids.some((messageUid) => !persistedSet.has(messageUid))) {
    throw checkpointConflict(
      "checkpoint retained messages must belong to its persisted message set",
      SESSION_ERROR_CODE.TURN_SUMMARY_CHECKPOINT_RETAINED_MESSAGE_MISSING,
    );
  }
}

function assertCheckpointMessagesResolved(messages, request) {
  const requestedUids = new Set([
    ...request.persistedMessageUids,
    ...request.summarizedMessageUids,
    ...request.retainedMessageUids,
  ]);
  const messagesByUid = new Map();
  for (const message of messages) {
    const messageUid = text(message?.messageUid);
    if (messageUid && requestedUids.has(messageUid)) messagesByUid.set(messageUid, message);
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
      text(message?.turnScopeId) !== request.turnScopeId
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
    const messageUid = text(message?.messageUid);
    if (summarizedSet.has(messageUid)) {
      if (message?.summarized === true) return message;
      markedCount += 1;
      return { ...message, summarized: true };
    }
    if (retainedSet.has(messageUid) && message?.summarized === true) {
      return { ...message, summarized: false };
    }
    return message;
  });
  return { nextMessages, markedCount };
}

function applyCheckpointCommit(session, currentState, request, committedAt) {
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
  session.messages = nextMessages;
  writeTurnSummaryCheckpoints(session, {
    ...session.turnSummaryCheckpoints,
    [request.turnScopeId]: appendTurnSummaryCheckpointReceipt(currentState, receipt),
  });
  session.updatedAt = committedAt;
  return { committed: true, markedCount, checkpointRevision, receipt };
}

export async function commitTurnSummaryCheckpoint(payload) {
  const request = parseCheckpointRequest(payload);
  const { userId, sessionId, persistenceContext } = request;
  return this.sessionRepo.withSessionMutation(
    userId,
    sessionId,
    async () => {
      const session = await this.sessionRepo.findById(userId, sessionId, { persistenceContext });
      if (!session) throw createSessionNotFoundError({ userId, sessionId });
      assertCheckpointTargetsTurn(session, request);
      const currentState = readTurnSummaryCheckpointState(session, request);
      const duplicate = resolveDuplicateCheckpoint(currentState, request);
      if (duplicate) return duplicate;
      assertCheckpointRevision(currentState.checkpointRevision, request);
      assertCheckpointDisposition(request);
      assertCheckpointMessagesResolved(session.messages, request);
      assertSummarizedToolPairClosure(session.messages, request.summarizedMessageUids);
      const result = applyCheckpointCommit(session, currentState, request, this.now());
      await this.sessionRepo.save(userId, session, { persistenceContext });
      return result;
    },
    { persistenceContext },
  );
}
