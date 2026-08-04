/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { randomUUID } from "node:crypto";
import { buildTurnTerminalCommand, upsertTurnStatusEntity } from "../../entities/turn-status-entity.js";
import { resolveDialogProcessIdFromContext, resolveMessageDialogProcessId } from "../../../context/session/dialog-process-id-resolver.js";
import { dedupeAttachments, normalizeIncomingAttachmentsForSessionMessage } from "./attachment-helpers.js";
import { resolveSessionVersion } from "./anchor-utils.js";
import { upsertSessionTurnTiming } from "./turn-timing.js";
import { commitTurnLifecycle, createAuthoritativeTurnSnapshot } from "@noobot/authoritative-state/application";
import {
  acknowledgeAuthorityEventDelivery,
  compactAuthorityEventOutbox,
  listPendingAuthorityEvents,
  recordAuthorityEventDeliveryAttempt,
  validateSessionProvisionIntent,
} from "@noobot/event-protocol";
import { normalizeSessionEntity } from "../../entities/session-entity.js";

export async function getTurnLifecycleSnapshot({ userId, sessionId, parentSessionId = "", persistenceContext = null, commandId = "", knownSequence, terminalLimit = 10 } = {}) {
  if (!userId || !sessionId) return { found: false, reason: "missing_session" };
  const resolvedParentSessionId = await this._resolveParentSessionId(userId, sessionId, parentSessionId, persistenceContext);
  const session = await this.sessionRepo.findById(userId, sessionId, resolvedParentSessionId, persistenceContext);
  if (!session) return { found: false, reason: "session_not_found" };
  return {
    found: true,
    snapshot: createAuthoritativeTurnSnapshot({
      lifecycle: session.turnLifecycle,
      turnTimings: session.turnTimings,
      terminalTurnScopeIds: [...new Set(
        (Array.isArray(session.messages) ? session.messages : [])
          .map((message) => String(message?.turnScopeId || "").trim())
          .filter(Boolean),
      )],
      commandId, userId, sessionId, knownSequence, terminalLimit,
      generatedAt: this.now(),
    }),
  };
}

export async function getPendingAuthorityEvents({ userId, sessionId, parentSessionId = "", persistenceContext = null, limit = 100 } = {}) {
  if (!userId || !sessionId) return { found: false, reason: "missing_session", events: [] };
  const resolvedParentSessionId = await this._resolveParentSessionId(userId, sessionId, parentSessionId, persistenceContext);
  const session = await this.sessionRepo.findById(userId, sessionId, resolvedParentSessionId, persistenceContext);
  if (!session) return { found: false, reason: "session_not_found", events: [] };
  return {
    found: true,
    events: listPendingAuthorityEvents(session.authorityEventOutbox, { limit }),
    version: resolveSessionVersion(session),
  };
}

export async function recordAuthorityEventAttempt({ userId, sessionId, parentSessionId = "", persistenceContext = null, eventId = "" } = {}) {
  if (!userId || !sessionId || !eventId) return { recorded: false, reason: "missing_identity" };
  return this._withSessionMutation(userId, sessionId, async () => {
    const resolvedParentSessionId = await this._resolveParentSessionId(userId, sessionId, parentSessionId, persistenceContext);
    const session = await this.sessionRepo.findById(userId, sessionId, resolvedParentSessionId, persistenceContext);
    if (!session) return { recorded: false, reason: "session_not_found" };
    const actualVersion = resolveSessionVersion(session);
    const result = recordAuthorityEventDeliveryAttempt(session.authorityEventOutbox, {
      eventId,
      attemptedAt: this.now(),
    });
    if (!result.found) return { recorded: false, reason: "event_not_found" };
    session.authorityEventOutbox = result.outbox;
    session.updatedAt = this.now();
    await this.sessionRepo.save(userId, session, resolvedParentSessionId, { expectedVersion: actualVersion, persistenceContext });
    return { recorded: true, event: result.outbox.find((item) => item.eventId === eventId), version: resolveSessionVersion(session) };
  }, parentSessionId, persistenceContext);
}

export async function acknowledgeAuthorityEvent({ userId, sessionId, parentSessionId = "", persistenceContext = null, eventId = "" } = {}) {
  if (!userId || !sessionId || !eventId) return { acknowledged: false, reason: "missing_identity" };
  return this._withSessionMutation(userId, sessionId, async () => {
    const resolvedParentSessionId = await this._resolveParentSessionId(userId, sessionId, parentSessionId, persistenceContext);
    const session = await this.sessionRepo.findById(userId, sessionId, resolvedParentSessionId, persistenceContext);
    if (!session) return { acknowledged: false, reason: "session_not_found" };
    const actualVersion = resolveSessionVersion(session);
    const result = acknowledgeAuthorityEventDelivery(session.authorityEventOutbox, {
      eventId,
      deliveredAt: this.now(),
    });
    if (!result.found) return { acknowledged: false, reason: "event_not_found" };
    if (!result.changed) return { acknowledged: true, deduplicated: true, version: actualVersion };
    session.authorityEventOutbox = result.outbox;
    session.updatedAt = this.now();
    await this.sessionRepo.save(userId, session, resolvedParentSessionId, { expectedVersion: actualVersion, persistenceContext });
    return { acknowledged: true, version: resolveSessionVersion(session) };
  }, parentSessionId, persistenceContext);
}

export async function compactAuthorityEvents({
  userId,
  sessionId,
  parentSessionId = "",
  persistenceContext = null,
  deliveredThroughSequence,
  retainDeliveredAfter = "",
} = {}) {
  if (!userId || !sessionId) return { compacted: false, reason: "missing_session" };
  return this._withSessionMutation(userId, sessionId, async () => {
    const resolvedParentSessionId = await this._resolveParentSessionId(userId, sessionId, parentSessionId, persistenceContext);
    const session = await this.sessionRepo.findById(userId, sessionId, resolvedParentSessionId, persistenceContext);
    if (!session) return { compacted: false, reason: "session_not_found" };
    const actualVersion = resolveSessionVersion(session);
    const result = compactAuthorityEventOutbox(session.authorityEventOutbox, {
      deliveredThroughSequence,
      retainDeliveredAfter,
      commandReceipts: session.turnLifecycle?.commandReceipts,
    });
    if (result.reason || !result.compacted) return { ...result, version: actualVersion };
    session.authorityEventOutbox = result.outbox;
    session.updatedAt = this.now();
    await this.sessionRepo.save(userId, session, resolvedParentSessionId, { expectedVersion: actualVersion, persistenceContext });
    return { ...result, version: resolveSessionVersion(session) };
  }, parentSessionId, persistenceContext);
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
    const result = commitTurnLifecycle({
      lifecycle: session.turnLifecycle,
      event: { ...event, userId, sessionId, parentSessionId: resolvedParentSessionId },
      eventOutbox: session.authorityEventOutbox,
      createEventId: randomUUID,
      now: this.now,
      materializeTerminal: ({ terminalStatus }) => {
        const currentTurnRevision = Number(
          session.turnLifecycle?.turns?.[event.turnScopeId]?.revision || 0,
        );
        const incoming = buildTurnTerminalCommand(terminalStatus.command, {
          turnScopeId: event.turnScopeId,
          dialogProcessId: event.dialogProcessId,
          parentDialogProcessId: terminalStatus.parentDialogProcessId,
          description: terminalStatus.description,
          error: terminalStatus.error,
          assistantMessage: terminalStatus.assistantMessage,
          updatedAt: this.now(),
        });
        if (!incoming) return { reason: "invalid_turn_status_command" };
        const statusResult = upsertTurnStatusEntity({
          statuses: session.turnStatuses,
          messages: session.messages,
          incoming,
          now: this.now,
        });
        return statusResult.turnStatus ? {
          turnStatus: statusResult.turnStatus,
          statuses: statusResult.statuses,
          messages: statusResult.messages,
          summaryVersion: currentTurnRevision + 1,
        } : { reason: "invalid_turn_status" };
      },
    });
    if (!result.applied) return { ...result, session, version: actualVersion };
    session.turnLifecycle = result.lifecycle;
    if (result.terminalMaterialization?.statuses) session.turnStatuses = result.terminalMaterialization.statuses;
    if (result.terminalMaterialization?.messages) session.messages = result.terminalMaterialization.messages;
    session.authorityEventOutbox = result.eventOutbox;
    session.updatedAt = this.now();
    if (session.shortMemoryCheckpoint === undefined) session.shortMemoryCheckpoint = 0;
    await this.sessionRepo.save(userId, session, resolvedParentSessionId, { expectedVersion: actualVersion, persistenceContext });
    return { ...result, session, turnStatus: result.terminalMaterialization?.turnStatus || null, version: resolveSessionVersion(session) };
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
    const result = commitTurnLifecycle({
      lifecycle: session.turnLifecycle,
      event: { ...event, userId, sessionId, parentSessionId: resolvedParentSessionId },
      eventOutbox: session.authorityEventOutbox,
      createEventId: randomUUID,
      now: this.now,
    });
    if (!result.applied) return { ...result, session: isNew ? null : session, version: actualVersion };
    session.turnLifecycle = result.lifecycle;
    session.authorityEventOutbox = result.eventOutbox;
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
        userMessage: targetMessage,
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
      userMessage: targetMessage,
      messageIndex: targetIndex,
      version: resolveSessionVersion(session),
      dialogProcessId: normalizedDialogProcessId,
    };
    }, parentSessionId, persistenceContext);
  }
