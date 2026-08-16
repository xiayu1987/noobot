/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { normalizeDialogProcessId } from "@noobot/session-protocol";
import { resolveContextMessageDialogProcessId } from "@noobot/context-protocol/message/codec";
import { createHash } from "node:crypto";
import { isTerminalTurnLifecycleState } from "@noobot/authoritative-state/domain";

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
} = {}) {
  return `sha256:${createHash("sha256")
    .update(
      JSON.stringify({
        dialogProcessId,
        turnScopeId,
        persistedMessageUids,
        summarizedMessageUids,
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

function resolveToolCalls(message = {}) {
  if (Array.isArray(message?.tool_calls)) return message.tool_calls;
  if (Array.isArray(message?.lc_kwargs?.tool_calls)) return message.lc_kwargs.tool_calls;
  return [];
}

function resolveToolCallId(message = {}) {
  return String(
    message?.tool_call_id || message?.toolCallId || message?.lc_kwargs?.tool_call_id || "",
  ).trim();
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
    for (const call of resolveToolCalls(message)) {
      const callId = String(call?.id || call?.tool_call_id || "").trim();
      if (callId) callOwnerById.set(toolPairKey(message, callId), messageUid);
    }
    const resultCallId = resolveToolCallId(message);
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
  const normalizedDialogProcessId = normalizeDialogProcessId(dialogProcessId);
  const normalizedTurnScopeId = String(turnScopeId || "").trim();
  const normalizedCheckpointId = String(checkpointId || "").trim();
  const normalizedPersistedUids = normalizeMessageUids(persistedMessageUids);
  const normalizedSummarizedUids = normalizeMessageUids(summarizedMessageUids);
  if (
    !userId ||
    !sessionId ||
    !normalizedDialogProcessId ||
    !normalizedTurnScopeId ||
    !normalizedCheckpointId
  ) {
    return { committed: false, reason: "missing_checkpoint_identity", markedCount: 0 };
  }

  return this._withSessionMutation(
    userId,
    sessionId,
    async () => {
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
      if (
        lifecycleTurn &&
        resolveContextMessageDialogProcessId(lifecycleTurn) !== normalizedDialogProcessId
      ) {
        throw checkpointConflict(
          "checkpoint does not own the lifecycle turn",
          "TURN_SUMMARY_CHECKPOINT_OWNERSHIP_CONFLICT",
        );
      }
      if (
        lifecycleTurn &&
        isTerminalTurnLifecycleState(lifecycleTurn.state) &&
        normalizedPersistedUids.length
      ) {
        throw checkpointConflict(
          "terminal checkpoint cannot persist additional messages",
          "TURN_SUMMARY_CHECKPOINT_TERMINAL_PERSISTENCE",
        );
      }
      const activeTurnScopeId = String(session?.turnLifecycle?.activeTurnScopeId || "").trim();
      if (activeTurnScopeId && activeTurnScopeId !== normalizedTurnScopeId) {
        throw checkpointConflict(
          "checkpoint does not target the active turn",
          "TURN_SUMMARY_CHECKPOINT_NOT_ACTIVE",
        );
      }

      const checkpointStates =
        session?.turnSummaryCheckpoints &&
        typeof session.turnSummaryCheckpoints === "object" &&
        !Array.isArray(session.turnSummaryCheckpoints)
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
      const existingReceipt = (
        Array.isArray(currentState.receipts) ? currentState.receipts : []
      ).find((receipt) => String(receipt?.checkpointId || "").trim() === normalizedCheckpointId);
      if (existingReceipt) {
        if (existingReceipt.requestHash !== requestHash) {
          throw checkpointConflict(
            "checkpointId was reused with a different payload",
            "TURN_SUMMARY_CHECKPOINT_ID_REUSED",
          );
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
      if (
        expectedCheckpointRevision !== undefined &&
        Number(expectedCheckpointRevision) !== currentRevision
      ) {
        const error = checkpointConflict(
          "turn summary checkpoint revision conflict",
          "TURN_SUMMARY_CHECKPOINT_REVISION_CONFLICT",
        );
        error.currentCheckpointRevision = currentRevision;
        throw error;
      }

      const requestedUids = new Set([...normalizedPersistedUids, ...normalizedSummarizedUids]);
      const messagesByUid = new Map();
      for (const message of Array.isArray(session.messages) ? session.messages : []) {
        const messageUid = String(message?.messageUid || "").trim();
        if (messageUid && requestedUids.has(messageUid)) messagesByUid.set(messageUid, message);
      }
      const resolvedMessageUids = [...messagesByUid.keys()];
      const unresolvedMessageUids = [...requestedUids].filter(
        (messageUid) => !messagesByUid.has(messageUid),
      );
      if (unresolvedMessageUids.length) {
        const error = checkpointConflict(
          `checkpoint contains ${unresolvedMessageUids.length} missing message UIDs`,
          "TURN_SUMMARY_CHECKPOINT_MESSAGE_MISSING",
        );
        error.requestedMessageIds = [...requestedUids];
        error.resolvedMessageIds = resolvedMessageUids;
        error.unresolvedMessageIds = unresolvedMessageUids;
        throw error;
      }
      for (const messageUid of normalizedPersistedUids) {
        const message = messagesByUid.get(messageUid);
        if (
          resolveContextMessageDialogProcessId(message) !== normalizedDialogProcessId ||
          String(message?.turnScopeId || "").trim() !== normalizedTurnScopeId
        ) {
          throw checkpointConflict(
            `persisted checkpoint message is outside the current turn: ${messageUid}`,
            "TURN_SUMMARY_CHECKPOINT_MESSAGE_SCOPE_CONFLICT",
          );
        }
      }

      assertSummarizedToolPairClosure(session.messages, normalizedSummarizedUids);

      const summarizedSet = new Set(normalizedSummarizedUids);
      let markedCount = 0;
      session.messages = (Array.isArray(session.messages) ? session.messages : []).map(
        (message) => {
          const messageUid = String(message?.messageUid || "").trim();
          if (!summarizedSet.has(messageUid) || message?.summarized === true) return message;
          markedCount += 1;
          return { ...message, summarized: true };
        },
      );
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
        receipts: [
          ...(Array.isArray(currentState.receipts) ? currentState.receipts : []),
          receipt,
        ].slice(-50),
      };
      session.turnSummaryCheckpoints = checkpointStates;
      session.updatedAt = receipt.committedAt;
      await this.sessionRepo.save(userId, session, resolvedParentSessionId, { persistenceContext });
      return { committed: true, markedCount, checkpointRevision, receipt };
    },
    parentSessionId,
    persistenceContext,
  );
}
