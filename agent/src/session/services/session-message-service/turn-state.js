/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { buildTurnTerminalCommand, upsertTurnStatusEntity } from "../../entities/turn-status-entity.js";
import { resolveDialogProcessIdFromContext, resolveMessageDialogProcessId } from "../../../context/session/dialog-process-id-resolver.js";
import { dedupeAttachments, normalizeIncomingAttachmentsForSessionMessage } from "./attachment-helpers.js";
import { resolveSessionVersion } from "./anchor-utils.js";
import { upsertSessionTurnTiming } from "./turn-timing.js";
import { normalizeTurnLifecycleEntity, transitionTurnLifecycle, isTerminalTurnLifecycleState, projectTurnLifecycleTiming } from "@noobot/authoritative-state/domain";
import { createTurnLifecycleSnapshot, validateSessionProvisionIntent } from "@noobot/authoritative-state/contracts";
import { normalizeSessionEntity } from "../../entities/session-entity.js";

export async function getTurnLifecycleSnapshot({ userId, sessionId, parentSessionId = "", persistenceContext = null, commandId = "", knownSequence, terminalLimit = 10 } = {}) {
  if (!userId || !sessionId) return { found: false, reason: "missing_session" };
  const resolvedParentSessionId = await this._resolveParentSessionId(userId, sessionId, parentSessionId, persistenceContext);
  const session = await this.sessionRepo.findById(userId, sessionId, resolvedParentSessionId, persistenceContext);
  if (!session) return { found: false, reason: "session_not_found" };
  const lifecycle = normalizeTurnLifecycleEntity(session.turnLifecycle || {});
  const activeTurn = lifecycle.turns[lifecycle.activeTurnScopeId]
    ? { ...projectTurnLifecycleTiming(lifecycle.turns[lifecycle.activeTurnScopeId], session.turnTimings), sessionId }
    : null;
  const limit = Math.max(0, Math.min(100, Number(terminalLimit) || 10));
  const recentTerminalTurns = Object.values(lifecycle.turns)
    .filter((turn) => isTerminalTurnLifecycleState(turn.state))
    .sort((a, b) => Number(b.sequence) - Number(a.sequence))
    .slice(0, limit)
    .map((turn) => ({ ...projectTurnLifecycleTiming(turn, session.turnTimings), sessionId }));
  return {
    found: true,
    snapshot: createTurnLifecycleSnapshot({
      commandId, userId, sessionId, sequence: lifecycle.sequence,
      activeTurnScopeId: lifecycle.activeTurnScopeId, activeTurn, recentTerminalTurns,
      unchanged: knownSequence !== undefined && Number(knownSequence) === lifecycle.sequence,
      generatedAt: this.now(),
    }),
  };
}

export async function applyTurnLifecycleEvent({
  userId,
  sessionId,
  parentSessionId = "",
  persistenceContext = null,
  expectedSessionVersion,
  ...event
} = {}) {
  if (!userId || !sessionId) return { applied: false, reason: "missing_session" };
  const provisionIntent = validateSessionProvisionIntent(event);
  if (!provisionIntent.valid) return { applied: false, reason: "invalid_session_provision_intent" };
  if (provisionIntent.requested) {
    return provisionSessionWithInitialTurn.call(this, {
      userId, sessionId, parentSessionId, persistenceContext, expectedSessionVersion, ...event,
    });
  }
  return this._withSessionMutation(userId, sessionId, async () => {
    const resolvedParentSessionId = await this._resolveParentSessionId(
      userId,
      sessionId,
      parentSessionId,
      persistenceContext,
    );
    const session = await this.sessionRepo.findById(userId, sessionId, resolvedParentSessionId, persistenceContext);
    if (!session) return { applied: false, reason: "session_not_found" };
    const actualVersion = resolveSessionVersion(session);
    if (expectedSessionVersion !== undefined && Number(expectedSessionVersion) !== actualVersion) {
      return { applied: false, reason: "session_version_conflict", currentVersion: actualVersion };
    }
    let turnStatus = null;
    let lifecycleEvent = event;
    const terminalStatus = event.terminalStatus && typeof event.terminalStatus === "object"
      ? event.terminalStatus
      : null;
    if (terminalStatus) {
      const nowValue = this.now();
      const incoming = buildTurnTerminalCommand(terminalStatus.command, {
        turnScopeId: event.turnScopeId,
        dialogProcessId: event.dialogProcessId,
        parentDialogProcessId: terminalStatus.parentDialogProcessId,
        description: terminalStatus.description,
        error: terminalStatus.error,
        updatedAt: nowValue,
      });
      if (!incoming) return { applied: false, reason: "invalid_turn_status_command", session, version: actualVersion };
      const statusResult = upsertTurnStatusEntity({
        statuses: session.turnStatuses,
        messages: session.messages,
        incoming,
        now: this.now,
      });
      turnStatus = statusResult.turnStatus;
      if (!turnStatus) return { applied: false, reason: "invalid_turn_status", session, version: actualVersion };
      session.turnStatuses = statusResult.statuses;
      lifecycleEvent = {
        ...event,
        summaryVersion: Number(event.summaryVersion || turnStatus.version || 0),
        completionCommitId: String(event.completionCommitId || event.commandId || "").trim(),
        terminalStatus: turnStatus,
      };
    }
    const result = transitionTurnLifecycle(session.turnLifecycle, lifecycleEvent, this.now);
    if (!result.applied) return { ...result, session, version: actualVersion };
    session.turnLifecycle = result.lifecycle;
    const committedTurn = result.lifecycle?.turns?.[String(event.turnScopeId || "").trim()] || null;
    if (committedTurn && isTerminalTurnLifecycleState(committedTurn.state)) {
      const materializedStatus = turnStatus || {
        turnScopeId: committedTurn.turnScopeId,
        dialogProcessId: committedTurn.dialogProcessId,
        status: committedTurn.state,
        error: committedTurn.failure || null,
        updatedAt: committedTurn.updatedAt,
      };
      committedTurn.terminalStatus = materializedStatus;
    }
    session.updatedAt = this.now();
    if (session.shortMemoryCheckpoint === undefined) session.shortMemoryCheckpoint = 0;
    await this.sessionRepo.save(userId, session, resolvedParentSessionId, { expectedVersion: actualVersion, persistenceContext });
    return { ...result, session, turnStatus, version: resolveSessionVersion(session) };
  }, parentSessionId, persistenceContext);
}

export async function provisionSessionWithInitialTurn({
  userId, sessionId, parentSessionId = "", persistenceContext = null, expectedSessionVersion, createSessionIfAbsent, ...event
} = {}) {
  const intent = validateSessionProvisionIntent({ ...event, createSessionIfAbsent });
  if (!intent.valid || !intent.requested) return { applied: false, reason: "invalid_session_provision_intent" };
  return this._withSessionMutation(userId, sessionId, async () => {
    const resolvedParentSessionId = await this._resolveParentSessionId(userId, sessionId, parentSessionId, persistenceContext);
    let session = await this.sessionRepo.findById(userId, sessionId, resolvedParentSessionId, persistenceContext);
    const isNew = !session;
    if (isNew && await this.sessionRepo.isSessionDeleted?.(userId, sessionId)) {
      return { applied: false, reason: "session_not_found" };
    }
    session ||= this.sessionRepo.createInitialSession?.({
      sessionId, parentSessionId: resolvedParentSessionId,
    }) || normalizeSessionEntity({ sessionId, parentSessionId: resolvedParentSessionId, messages: [] }, {
      now: this.now, sessionId, parentSessionId: resolvedParentSessionId,
    });
    const actualVersion = resolveSessionVersion(session);
    if (expectedSessionVersion !== undefined && Number(expectedSessionVersion) !== actualVersion) {
      return { applied: false, reason: "session_version_conflict", currentVersion: actualVersion };
    }
    const result = transitionTurnLifecycle(session.turnLifecycle, event, this.now);
    if (!result.applied) return { ...result, session: isNew ? null : session, version: actualVersion };
    session.turnLifecycle = result.lifecycle;
    session.updatedAt = this.now();
    if (session.shortMemoryCheckpoint === undefined) session.shortMemoryCheckpoint = 0;
    const saved = await this.sessionRepo.save(userId, session, resolvedParentSessionId, {
      expectedVersion: isNew ? undefined : actualVersion,
      createOnly: isNew,
      persistenceContext,
    });
    if (saved === false) return { applied: false, reason: "session_not_found" };
    return { ...result, session, version: resolveSessionVersion(session), sessionCreated: isNew };
  }, parentSessionId, persistenceContext);
}

export async function upsertTurnStatus({
    userId,
    sessionId,
    parentSessionId = "",
    persistenceContext = null,
    turnScopeId = "",
    dialogProcessId = "",
    parentDialogProcessId = "",
    command = "",
    description = "",
    error = null,
  } = {}) {
    if (!userId || !sessionId) return { upserted: false, reason: "missing_session" };
    return this._withSessionMutation(userId, sessionId, async () => {
    const resolvedParentSessionId = await this._resolveParentSessionId(
      userId,
      sessionId,
      parentSessionId,
      persistenceContext,
    );
    const session = await this.sessionRepo.findById(userId, sessionId, resolvedParentSessionId, persistenceContext);
    if (!session) return { upserted: false, reason: "session_not_found" };
    const nowValue = this.now();
    const incoming = buildTurnTerminalCommand(command, {
      turnScopeId,
      dialogProcessId,
      parentDialogProcessId,
      description,
      error,
      updatedAt: nowValue,
    });
    if (!incoming) return { upserted: false, reason: "invalid_turn_status_command" };
    const upsertResult = upsertTurnStatusEntity({
      statuses: session.turnStatuses,
      messages: session.messages,
      incoming,
      now: this.now,
    });
    const turnStatus = upsertResult.turnStatus;
    if (!turnStatus) return { upserted: false, reason: "invalid_turn_status" };
    session.turnStatuses = upsertResult.statuses;
    if (!upsertResult.changed) {
      return { upserted: false, reason: "unchanged", session, turnStatus, version: resolveSessionVersion(session) };
    }
    session.updatedAt = nowValue;
    if (session.shortMemoryCheckpoint === undefined) session.shortMemoryCheckpoint = 0;
    await this.sessionRepo.save(userId, session, resolvedParentSessionId, { persistenceContext });
    return { upserted: true, session, turnStatus, version: resolveSessionVersion(session) };
    }, parentSessionId, persistenceContext);
  }

export async function upsertTurnTiming({
    userId,
    sessionId,
    parentSessionId = "",
    persistenceContext = null,
    turnScopeId = "",
    dialogProcessId = "",
    thinkingStartedAt = "",
    thinkingFinishedAt = "",
  } = {}) {
    if (!userId || !sessionId) return { upserted: false, reason: "missing_session" };
    return this._withSessionMutation(userId, sessionId, async () => {
      const resolvedParentSessionId = await this._resolveParentSessionId(
        userId,
        sessionId,
        parentSessionId,
        persistenceContext,
      );
      const session = await this.sessionRepo.findById(userId, sessionId, resolvedParentSessionId, persistenceContext);
      if (!session) return { upserted: false, reason: "session_not_found" };
      const before = JSON.stringify(session.turnTimings || []);
      upsertSessionTurnTiming(session, {
        turnScopeId,
        dialogProcessId,
        thinkingStartedAt,
        thinkingFinishedAt,
      });
      if (JSON.stringify(session.turnTimings || []) === before) {
        return { upserted: false, reason: "unchanged", session };
      }
      session.updatedAt = this.now();
      if (session.shortMemoryCheckpoint === undefined) session.shortMemoryCheckpoint = 0;
      await this.sessionRepo.save(userId, session, resolvedParentSessionId, { persistenceContext });
      return { upserted: true, session };
    }, parentSessionId, persistenceContext);
  }

export async function stampReusedUserTurnDialogProcessId({
    userId,
    sessionId,
    parentSessionId = "",
    persistenceContext = null,
    turnScopeId = "",
    dialogProcessId = "",
    attachments = undefined,
  } = {}) {
    if (!userId || !sessionId) return { stamped: false, reason: "missing_session" };
    const normalizedTurnScopeId = String(turnScopeId || "").trim();
    if (!normalizedTurnScopeId) return { stamped: false, reason: "missing_turn_scope" };
    const normalizedDialogProcessId = resolveDialogProcessIdFromContext({ dialogProcessId });
    if (!normalizedDialogProcessId) return { stamped: false, reason: "missing_dialog_process_id" };
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
    if (!session) return { stamped: false, reason: "session_not_found" };
    const messages = Array.isArray(session.messages) ? session.messages : [];
    const targetIndex = (() => {
      for (let index = messages.length - 1; index >= 0; index -= 1) {
        const messageItem = messages[index];
        if (String(messageItem?.role || "").trim() !== "user") continue;
        if (String(messageItem?.turnScopeId || "").trim() !== normalizedTurnScopeId) continue;
        if (messageItem?.injectedMessage === true || messageItem?.pluginMessage === true) continue;
        return index;
      }
      return -1;
    })();
    if (targetIndex < 0) return { stamped: false, reason: "user_message_not_found" };

    const targetMessage = messages[targetIndex];
    const shouldSyncAttachments = Array.isArray(attachments);
    const nextAttachments = shouldSyncAttachments
      ? normalizeIncomingAttachmentsForSessionMessage(targetMessage.attachments, attachments)
      : undefined;
    const dialogProcessIdChanged =
      resolveMessageDialogProcessId(targetMessage) !== normalizedDialogProcessId;
    const attachmentsChanged = shouldSyncAttachments &&
      JSON.stringify(dedupeAttachments(targetMessage.attachments)) !== JSON.stringify(nextAttachments);
    if (!dialogProcessIdChanged && !attachmentsChanged) {
      return {
        stamped: false,
        reason: "unchanged",
        session,
        messageIndex: targetIndex,
        dialogProcessId: normalizedDialogProcessId,
      };
    }
    if (dialogProcessIdChanged) {
      targetMessage.dialogProcessId = normalizedDialogProcessId;
      delete targetMessage.dialogId;
    }
    if (shouldSyncAttachments) {
      targetMessage.attachments = nextAttachments;
    }
    session.updatedAt = this.now();
    if (session.shortMemoryCheckpoint === undefined) session.shortMemoryCheckpoint = 0;
    await this.sessionRepo.save(userId, session, resolvedParentSessionId, { persistenceContext });
    return {
      stamped: true,
      session,
      messageIndex: targetIndex,
      version: resolveSessionVersion(session),
      dialogProcessId: normalizedDialogProcessId,
    };
    }, parentSessionId, persistenceContext);
  }
