/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { normalizeDialogProcessId } from "@noobot/session-protocol";
import {
  resolveContextMessageDialogProcessId,
  resolveContextToolCallId,
  resolveContextToolCalls,
} from "@noobot/context-protocol/message/codec";
import { createHash } from "node:crypto";
import { isTerminalTurnLifecycleState } from "@noobot/authoritative-state/domain";
import { resolveDeletedSessionAs } from "./session-deleted-result.js";

const EMPTY_CHECKPOINT_STATE = Object.freeze({ checkpointRevision: 0, receipts: [] });

function normalizeMessageUids(values = []) {
  return [
    ...new Set(
      (Array.isArray(values) ? values : [])
        .map((value) => String(value || "").trim())
        .filter(Boolean),
    ),
  ];
}

function checkpointRequestHash({
  dialogProcessId = "",
  turnScopeId = "",
  persistedMessageUids = [],
  summarizedMessageUids = [],
  retainedMessageUids = [],
} = {}) {
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

function checkpointConflict(message = "", code = "TURN_SUMMARY_CHECKPOINT_CONFLICT") {
  const error = new Error(message);
  error.code = code;
  error.statusCode = 409;
  return error;
}

function toolPairKey(message = {}, callId = "") {
  return [
    resolveContextMessageDialogProcessId(message),
    String(message?.turnScopeId || "").trim(),
    String(callId || "").trim(),
  ].join("\u0000");
}

function assertSummarizedToolPairClosure(messages = [], summarizedMessageUids = []) {
  const summarizedSet = new Set(summarizedMessageUids);
  const callOwnerById = new Map();
  const resultUidsByCallId = new Map();
  for (const message of messages) {
    const messageUid = String(message?.messageUid || "").trim();
    if (!messageUid) continue;
    for (const call of resolveContextToolCalls(message)) {
      const callId = resolveContextToolCallId(call);
      if (callId) callOwnerById.set(toolPairKey(message, callId), messageUid);
    }
    const resultCallId = resolveContextToolCallId(message);
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
      "TURN_SUMMARY_CHECKPOINT_TOOL_PAIR_SPLIT",
    );
  }
}

function normalizeCheckpointRequest(payload) {
  const request = {
    userId: payload.userId,
    sessionId: payload.sessionId,
    parentSessionId: payload.parentSessionId || "",
    persistenceContext: payload.persistenceContext || null,
    dialogProcessId: normalizeDialogProcessId(payload.dialogProcessId || ""),
    turnScopeId: String(payload.turnScopeId || "").trim(),
    checkpointId: String(payload.checkpointId || "").trim(),
    expectedCheckpointRevision: payload.expectedCheckpointRevision,
    persistedMessageUids: normalizeMessageUids(payload.persistedMessageUids),
    summarizedMessageUids: normalizeMessageUids(payload.summarizedMessageUids),
    retainedMessageUids: normalizeMessageUids(payload.retainedMessageUids),
  };
  request.requestHash = checkpointRequestHash(request);
  return request;
}

function hasCheckpointIdentity(request) {
  return Boolean(
    request.userId &&
    request.sessionId &&
    request.dialogProcessId &&
    request.turnScopeId &&
    request.checkpointId,
  );
}

function assertCheckpointTargetsTurn(session, request) {
  const lifecycle = session.turnLifecycle;
  const lifecycleTurn = lifecycle.turns?.[request.turnScopeId];
  if (lifecycleTurn) {
    if (resolveContextMessageDialogProcessId(lifecycleTurn) !== request.dialogProcessId) {
      throw checkpointConflict(
        "checkpoint does not own the lifecycle turn",
        "TURN_SUMMARY_CHECKPOINT_OWNERSHIP_CONFLICT",
      );
    }
    if (isTerminalTurnLifecycleState(lifecycleTurn.state) && request.persistedMessageUids.length) {
      throw checkpointConflict(
        "terminal checkpoint cannot persist additional messages",
        "TURN_SUMMARY_CHECKPOINT_TERMINAL_PERSISTENCE",
      );
    }
  }
  const activeTurnScopeId = String(lifecycle.activeTurnScopeId || "").trim();
  if (activeTurnScopeId && activeTurnScopeId !== request.turnScopeId) {
    throw checkpointConflict(
      "checkpoint does not target the active turn",
      "TURN_SUMMARY_CHECKPOINT_NOT_ACTIVE",
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
      "TURN_SUMMARY_CHECKPOINT_ID_REUSED",
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
  if (
    request.expectedCheckpointRevision === undefined ||
    Number(request.expectedCheckpointRevision) === currentRevision
  ) {
    return;
  }
  const error = checkpointConflict(
    "turn summary checkpoint revision conflict",
    "TURN_SUMMARY_CHECKPOINT_REVISION_CONFLICT",
  );
  error.currentCheckpointRevision = currentRevision;
  throw error;
}

function assertCheckpointDisposition(request) {
  const summarizedSet = new Set(request.summarizedMessageUids);
  if (request.retainedMessageUids.some((messageUid) => summarizedSet.has(messageUid))) {
    throw checkpointConflict(
      "checkpoint cannot summarize and retain the same message",
      "TURN_SUMMARY_CHECKPOINT_DISPOSITION_CONFLICT",
    );
  }
  const persistedSet = new Set(request.persistedMessageUids);
  if (request.retainedMessageUids.some((messageUid) => !persistedSet.has(messageUid))) {
    throw checkpointConflict(
      "checkpoint retained messages must belong to its persisted message set",
      "TURN_SUMMARY_CHECKPOINT_RETAINED_MESSAGE_MISSING",
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
    const messageUid = String(message?.messageUid || "").trim();
    if (messageUid && requestedUids.has(messageUid)) messagesByUid.set(messageUid, message);
  }
  const unresolvedMessageUids = [...requestedUids].filter(
    (messageUid) => !messagesByUid.has(messageUid),
  );
  if (unresolvedMessageUids.length) {
    const error = checkpointConflict(
      `checkpoint contains ${unresolvedMessageUids.length} missing message UIDs`,
      "TURN_SUMMARY_CHECKPOINT_MESSAGE_MISSING",
    );
    error.requestedMessageIds = [...requestedUids];
    error.resolvedMessageIds = [...messagesByUid.keys()];
    error.unresolvedMessageIds = unresolvedMessageUids;
    throw error;
  }
  for (const messageUid of request.persistedMessageUids) {
    const message = messagesByUid.get(messageUid);
    if (
      resolveContextMessageDialogProcessId(message) !== request.dialogProcessId ||
      String(message?.turnScopeId || "").trim() !== request.turnScopeId
    ) {
      throw checkpointConflict(
        `persisted checkpoint message is outside the current turn: ${messageUid}`,
        "TURN_SUMMARY_CHECKPOINT_MESSAGE_SCOPE_CONFLICT",
      );
    }
  }
}

function markCheckpointMessages(messages, request) {
  const summarizedSet = new Set(request.summarizedMessageUids);
  const retainedSet = new Set(request.retainedMessageUids);
  let markedCount = 0;
  const nextMessages = messages.map((message) => {
    const messageUid = String(message?.messageUid || "").trim();
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
  session.turnSummaryCheckpoints = {
    ...session.turnSummaryCheckpoints,
    [request.turnScopeId]: {
      dialogProcessId: request.dialogProcessId,
      turnScopeId: request.turnScopeId,
      checkpointRevision,
      receipts: [...currentState.receipts, receipt].slice(-50),
    },
  };
  session.updatedAt = committedAt;
  return { committed: true, markedCount, checkpointRevision, receipt };
}

export async function commitTurnSummaryCheckpoint(payload = {}) {
  const request = normalizeCheckpointRequest(payload);
  if (!hasCheckpointIdentity(request)) {
    return { committed: false, reason: "missing_checkpoint_identity", markedCount: 0 };
  }
  const { userId, sessionId, parentSessionId, persistenceContext } = request;
  const mutation = this._withSessionMutation(
    userId,
    sessionId,
    async () => {
      const { session, resolvedParentSessionId } = await this._findSession(
        userId,
        sessionId,
        parentSessionId,
        persistenceContext,
      );
      if (!session) return { committed: false, reason: "session_not_found", markedCount: 0 };
      assertCheckpointTargetsTurn(session, request);
      const currentState =
        session.turnSummaryCheckpoints?.[request.turnScopeId] || EMPTY_CHECKPOINT_STATE;
      const duplicate = resolveDuplicateCheckpoint(currentState, request);
      if (duplicate) return duplicate;
      assertCheckpointRevision(currentState.checkpointRevision, request);
      assertCheckpointDisposition(request);
      assertCheckpointMessagesResolved(session.messages, request);
      assertSummarizedToolPairClosure(session.messages, request.summarizedMessageUids);
      const result = applyCheckpointCommit(session, currentState, request, this.now());
      await this.sessionRepo.save(userId, session, resolvedParentSessionId, { persistenceContext });
      return result;
    },
    parentSessionId,
    persistenceContext,
  );
  return resolveDeletedSessionAs(mutation, { committed: false, markedCount: 0 });
}
