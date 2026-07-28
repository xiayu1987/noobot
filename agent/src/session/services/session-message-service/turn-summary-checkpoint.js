/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { createHash } from "node:crypto";
import { resolveDialogProcessIdFromContext, resolveMessageDialogProcessId } from "../../../context/session/dialog-process-id-resolver.js";
import { isTerminalTurnLifecycleState } from "../../entities/turn-lifecycle-entity.js";

function normalizeMessageUids(values = []) {
  return [...new Set((Array.isArray(values) ? values : [])
    .map((value) => String(value || "").trim())
    .filter(Boolean))];
}

function checkpointRequestHash({ dialogProcessId = "", turnScopeId = "", persistedMessageUids = [], summarizedMessageUids = [] } = {}) {
  return `sha256:${createHash("sha256").update(JSON.stringify({
    dialogProcessId,
    turnScopeId,
    persistedMessageUids,
    summarizedMessageUids,
  })).digest("hex")}`;
}

function checkpointConflict(message = "", code = "TURN_SUMMARY_CHECKPOINT_CONFLICT") {
  const error = new Error(message);
  error.code = code;
  error.statusCode = 409;
  return error;
}

export async function commitTurnSummaryCheckpoint({
  userId,
  sessionId,
  parentSessionId = "",
  persistenceContext = null,
  dialogProcessId = "",
  turnScopeId = "",
  checkpointId = "",
  expectedCheckpointRevision,
  persistedMessageUids = [],
  summarizedMessageUids = [],
} = {}) {
  const normalizedDialogProcessId = resolveDialogProcessIdFromContext({ dialogProcessId });
  const normalizedTurnScopeId = String(turnScopeId || "").trim();
  const normalizedCheckpointId = String(checkpointId || "").trim();
  const normalizedPersistedUids = normalizeMessageUids(persistedMessageUids);
  const normalizedSummarizedUids = normalizeMessageUids(summarizedMessageUids);
  if (!userId || !sessionId || !normalizedDialogProcessId || !normalizedTurnScopeId || !normalizedCheckpointId) {
    return { committed: false, reason: "missing_checkpoint_identity", markedCount: 0 };
  }

  return this._withSessionMutation(userId, sessionId, async () => {
    const resolvedParentSessionId = await this._resolveParentSessionId(
      userId,
      sessionId,
      parentSessionId,
      persistenceContext,
    );
    const session = await this.sessionRepo.findById(
      userId,
      sessionId,
      resolvedParentSessionId,
      persistenceContext,
    );
    if (!session) return { committed: false, reason: "session_not_found", markedCount: 0 };

    const lifecycleTurn = session?.turnLifecycle?.turns?.[normalizedTurnScopeId] || null;
    if (lifecycleTurn && resolveMessageDialogProcessId(lifecycleTurn) !== normalizedDialogProcessId) {
      throw checkpointConflict("checkpoint does not own the lifecycle turn", "TURN_SUMMARY_CHECKPOINT_OWNERSHIP_CONFLICT");
    }
    if (lifecycleTurn && isTerminalTurnLifecycleState(lifecycleTurn.state)) {
      throw checkpointConflict("checkpoint cannot modify a terminal turn", "TURN_SUMMARY_CHECKPOINT_TERMINAL");
    }
    const activeTurnScopeId = String(session?.turnLifecycle?.activeTurnScopeId || "").trim();
    if (activeTurnScopeId && activeTurnScopeId !== normalizedTurnScopeId) {
      throw checkpointConflict("checkpoint does not target the active turn", "TURN_SUMMARY_CHECKPOINT_NOT_ACTIVE");
    }

    const checkpointStates = session?.turnSummaryCheckpoints && typeof session.turnSummaryCheckpoints === "object"
      && !Array.isArray(session.turnSummaryCheckpoints)
      ? { ...session.turnSummaryCheckpoints }
      : {};
    const currentState = checkpointStates[normalizedTurnScopeId] || {};
    const currentRevision = Math.max(0, Number(currentState.checkpointRevision) || 0);
    const requestHash = checkpointRequestHash({
      dialogProcessId: normalizedDialogProcessId,
      turnScopeId: normalizedTurnScopeId,
      persistedMessageUids: normalizedPersistedUids,
      summarizedMessageUids: normalizedSummarizedUids,
    });
    const existingReceipt = (Array.isArray(currentState.receipts) ? currentState.receipts : [])
      .find((receipt) => String(receipt?.checkpointId || "").trim() === normalizedCheckpointId);
    if (existingReceipt) {
      if (existingReceipt.requestHash !== requestHash) {
        throw checkpointConflict("checkpointId was reused with a different payload", "TURN_SUMMARY_CHECKPOINT_ID_REUSED");
      }
      return {
        committed: false,
        deduplicated: true,
        reason: "duplicate_checkpoint",
        markedCount: Number(existingReceipt.markedCount) || 0,
        checkpointRevision: Number(existingReceipt.checkpointRevision) || currentRevision,
        receipt: existingReceipt,
      };
    }
    if (expectedCheckpointRevision !== undefined && Number(expectedCheckpointRevision) !== currentRevision) {
      const error = checkpointConflict("turn summary checkpoint revision conflict", "TURN_SUMMARY_CHECKPOINT_REVISION_CONFLICT");
      error.currentCheckpointRevision = currentRevision;
      throw error;
    }

    const requestedUids = new Set([...normalizedPersistedUids, ...normalizedSummarizedUids]);
    const messagesByUid = new Map();
    for (const message of Array.isArray(session.messages) ? session.messages : []) {
      const messageUid = String(message?.messageUid || "").trim();
      if (messageUid && requestedUids.has(messageUid)) messagesByUid.set(messageUid, message);
    }
    for (const messageUid of requestedUids) {
      const message = messagesByUid.get(messageUid);
      if (!message) {
        throw checkpointConflict(`checkpoint message does not exist: ${messageUid}`, "TURN_SUMMARY_CHECKPOINT_MESSAGE_MISSING");
      }
      if (
        resolveMessageDialogProcessId(message) !== normalizedDialogProcessId ||
        String(message?.turnScopeId || "").trim() !== normalizedTurnScopeId
      ) {
        throw checkpointConflict(`checkpoint message is outside the current turn: ${messageUid}`, "TURN_SUMMARY_CHECKPOINT_MESSAGE_SCOPE_CONFLICT");
      }
    }

    const summarizedSet = new Set(normalizedSummarizedUids);
    let markedCount = 0;
    session.messages = (Array.isArray(session.messages) ? session.messages : []).map((message) => {
      const messageUid = String(message?.messageUid || "").trim();
      if (!summarizedSet.has(messageUid) || message?.summarized === true) return message;
      markedCount += 1;
      return { ...message, summarized: true };
    });
    const checkpointRevision = currentRevision + 1;
    const receipt = {
      checkpointId: normalizedCheckpointId,
      checkpointRevision,
      requestHash,
      persistedMessageUids: normalizedPersistedUids,
      summarizedMessageUids: normalizedSummarizedUids,
      markedCount,
      committedAt: this.now(),
    };
    checkpointStates[normalizedTurnScopeId] = {
      dialogProcessId: normalizedDialogProcessId,
      turnScopeId: normalizedTurnScopeId,
      checkpointRevision,
      receipts: [...(Array.isArray(currentState.receipts) ? currentState.receipts : []), receipt].slice(-50),
    };
    session.turnSummaryCheckpoints = checkpointStates;
    session.updatedAt = receipt.committedAt;
    await this.sessionRepo.save(userId, session, resolvedParentSessionId, { persistenceContext });
    return { committed: true, markedCount, checkpointRevision, receipt };
  }, parentSessionId, persistenceContext);
}
