/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { resolveContextMessageDialogProcessId } from "@noobot/context-protocol/message/codec";
import { randomUUID } from "node:crypto";
import { projectCanonicalAttachmentIdentities } from "../../../artifacts/index.js";
import { dedupeAttachments } from "./attachment-helpers.js";
import { resolveAggregateVersion } from "./anchor-utils.js";
import { upsertSessionTurnTiming } from "./turn-timing.js";
import { commitTurnLifecycle } from "@noobot/authoritative-state/application";
import {
  acknowledgeAuthorityEventDelivery,
  compactAuthorityEventOutbox,
  listPendingAuthorityEvents,
  recordAuthorityEventDeliveryAttempt,
} from "@noobot/event-protocol";
import {
  SESSION_ERROR_CODE,
  TURN_EVENT,
  assertTurnAcceptanceUserMessage,
  decideAggregateConcurrency,
  materializeTurnTerminalMessages,
  normalizeDialogProcessId,
  validateSessionProvisionIntent,
} from "@noobot/session-protocol";
import {
  createSessionMessageUid,
  normalizeMessageEntity,
  normalizeSessionEntity,
} from "../../entities/session-entity.js";
import { appendDialogOrderEntry } from "../../entities/dialog-order-entity.js";
import { createSessionTurnLifecycleSnapshot } from "../../session-turn-read-model.js";

function validateAcceptedUserMessage(event = {}) {
  const validation = assertTurnAcceptanceUserMessage(event);
  return validation.materialize ? validation.value : null;
}

function resolveTurnAcceptance(service, session, event = {}) {
  const lifecycleEvent = { ...event };
  if (
    String(lifecycleEvent.eventType || "").trim() === TURN_EVENT.ACTION_ACCEPTED &&
    String(lifecycleEvent.action || "").trim() !== "resend" &&
    !String(lifecycleEvent.dialogProcessId || "").trim()
  ) {
    const turnScopeId = String(lifecycleEvent.turnScopeId || "").trim();
    const existingDialogProcessId = String(
      session?.turnLifecycle?.turns?.[turnScopeId]?.dialogProcessId || "",
    ).trim();
    if (!existingDialogProcessId && typeof service.allocateDialogProcessId !== "function") {
      throw new TypeError("Turn acceptance requires a dialog identity allocator");
    }
    lifecycleEvent.dialogProcessId =
      existingDialogProcessId || String(service.allocateDialogProcessId()).trim();
  }
  return {
    lifecycleEvent,
    acceptedUserMessageInput: validateAcceptedUserMessage(lifecycleEvent),
  };
}

function materializeAcceptedUserMessage({
  session,
  event,
  input,
  userId,
  sessionId,
  parentSessionId,
  nowValue,
}) {
  if (!input) return null;
  const existing = (Array.isArray(session.messages) ? session.messages : []).find(
    (message) =>
      String(message?.role || "").trim() === "user" &&
      String(message?.turnScopeId || "").trim() === String(event.turnScopeId || "").trim(),
  );
  if (existing) return existing;
  const userMessage = normalizeMessageEntity(
    {
      messageUid: createSessionMessageUid(),
      messageId: input.messageId,
      role: "user",
      type: "message",
      content: input.content,
      userName: String(userId),
      sessionId,
      parentSessionId,
      dialogProcessId: String(event.dialogProcessId || "").trim(),
      parentDialogProcessId: input.parentDialogProcessId,
      turnScopeId: String(event.turnScopeId || "").trim(),
      frontendUserMessage: input.frontendUserMessage,
      messageOrigin: input.frontendUserMessage ? "user" : "internal",
      attachments: [],
      turnCommit: {
        action: String(event.action || "send").trim(),
        commandId: String(event.causationId || event.commandId || "").trim(),
        runState: "pending_start",
        ...(event.continuationSource
          ? {
              resumeDialogProcessId: String(event.continuationSource.dialogProcessId || "").trim(),
              resumeTurnScopeId: String(event.continuationSource.turnScopeId || "").trim(),
            }
          : {}),
      },
      ts: nowValue,
    },
    () => nowValue,
  );
  session.messages = [...(Array.isArray(session.messages) ? session.messages : []), userMessage];
  session.dialogOrder = appendDialogOrderEntry(session.dialogOrder, userMessage);
  return userMessage;
}

export async function getTurnLifecycleSnapshot({
  userId,
  sessionId,
  parentSessionId = "",
  persistenceContext = null,
  commandId = "",
  knownSequence,
  terminalLimit = 10,
} = {}) {
  if (!userId || !sessionId) return { found: false, reason: "missing_session" };
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
  if (!session) return { found: false, reason: "session_not_found" };
  return {
    found: true,
    snapshot: createSessionTurnLifecycleSnapshot({
      session,
      commandId,
      userId,
      knownSequence,
      terminalLimit,
      generatedAt: this.now(),
    }),
  };
}

export async function getPendingAuthorityEvents({
  userId,
  sessionId,
  parentSessionId = "",
  persistenceContext = null,
  limit = 100,
} = {}) {
  if (!userId || !sessionId) return { found: false, reason: "missing_session", events: [] };
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
  if (!session) return { found: false, reason: "session_not_found", events: [] };
  return {
    found: true,
    events: listPendingAuthorityEvents(session.authorityEventOutbox, { limit }),
    aggregateVersion: resolveAggregateVersion(session),
  };
}

export async function recordAuthorityEventAttempt({
  userId,
  sessionId,
  parentSessionId = "",
  persistenceContext = null,
  eventId = "",
} = {}) {
  if (!userId || !sessionId || !eventId) return { recorded: false, reason: "missing_identity" };
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
      if (!session) return { recorded: false, reason: "session_not_found" };
      const actualVersion = resolveAggregateVersion(session);
      const result = recordAuthorityEventDeliveryAttempt(session.authorityEventOutbox, {
        eventId,
        attemptedAt: this.now(),
      });
      if (!result.found) return { recorded: false, reason: "event_not_found" };
      session.authorityEventOutbox = result.outbox;
      session.updatedAt = this.now();
      await this.sessionRepo.save(userId, session, resolvedParentSessionId, {
        expectedAggregateVersion: actualVersion,
        persistenceContext,
      });
      return {
        recorded: true,
        event: result.outbox.find((item) => item.eventId === eventId),
        aggregateVersion: resolveAggregateVersion(session),
      };
    },
    parentSessionId,
    persistenceContext,
  );
}

export async function acknowledgeAuthorityEvent({
  userId,
  sessionId,
  parentSessionId = "",
  persistenceContext = null,
  eventId = "",
  consumerId = "",
  orderingDomain = "",
  orderingScopeId = "",
  sequence,
} = {}) {
  if (!userId || !sessionId || !eventId || !consumerId || !orderingDomain || !orderingScopeId) {
    return { acknowledged: false, reason: "missing_identity" };
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
      if (!session) return { acknowledged: false, reason: "session_not_found" };
      const actualVersion = resolveAggregateVersion(session);
      const result = acknowledgeAuthorityEventDelivery(session.authorityEventOutbox, {
        eventId,
        consumerId,
        orderingDomain,
        orderingScopeId,
        sequence,
        deliveredAt: this.now(),
      });
      if (result.reason) return { acknowledged: false, reason: result.reason };
      if (!result.found) return { acknowledged: false, reason: "event_not_found" };
      if (!result.changed)
        return { acknowledged: true, deduplicated: true, aggregateVersion: actualVersion };
      session.authorityEventOutbox = result.outbox;
      session.updatedAt = this.now();
      await this.sessionRepo.save(userId, session, resolvedParentSessionId, {
        expectedAggregateVersion: actualVersion,
        persistenceContext,
      });
      return { acknowledged: true, aggregateVersion: resolveAggregateVersion(session) };
    },
    parentSessionId,
    persistenceContext,
  );
}

export async function compactAuthorityEvents({
  userId,
  sessionId,
  parentSessionId = "",
  persistenceContext = null,
  deliveredThroughSequence,
  consumerId = "",
  orderingDomain = "",
  orderingScopeId = "",
  retainDeliveredAfter = "",
} = {}) {
  if (!userId || !sessionId || !consumerId || !orderingDomain || !orderingScopeId) {
    return { compacted: false, reason: "missing_compaction_identity" };
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
      if (!session) return { compacted: false, reason: "session_not_found" };
      const actualVersion = resolveAggregateVersion(session);
      const result = compactAuthorityEventOutbox(session.authorityEventOutbox, {
        deliveredThroughSequence,
        consumerId,
        orderingDomain,
        orderingScopeId,
        retainDeliveredAfter,
      });
      if (result.reason || !result.compacted) return { ...result, aggregateVersion: actualVersion };
      session.authorityEventOutbox = result.outbox;
      session.updatedAt = this.now();
      await this.sessionRepo.save(userId, session, resolvedParentSessionId, {
        expectedAggregateVersion: actualVersion,
        persistenceContext,
      });
      return { ...result, aggregateVersion: resolveAggregateVersion(session) };
    },
    parentSessionId,
    persistenceContext,
  );
}

export async function applyTurnLifecycleEvent({
  userId,
  sessionId,
  parentSessionId = "",
  persistenceContext = null,
  expectedAggregateVersion,
  ...event
} = {}) {
  if (!userId || !sessionId) return { applied: false, reason: "missing_session" };
  const provisionIntent = validateSessionProvisionIntent(event);
  if (!provisionIntent.valid) return { applied: false, reason: "invalid_session_provision_intent" };
  if (provisionIntent.requested) {
    return provisionSessionWithInitialTurn.call(this, {
      userId,
      sessionId,
      parentSessionId,
      persistenceContext,
      expectedAggregateVersion,
      ...event,
    });
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
      if (!session) return { applied: false, reason: "session_not_found" };
      const { lifecycleEvent, acceptedUserMessageInput } = resolveTurnAcceptance(
        this,
        session,
        event,
      );
      const actualVersion = resolveAggregateVersion(session);
      const concurrency = decideAggregateConcurrency({
        expectedAggregateVersion:
          expectedAggregateVersion === undefined ? null : Number(expectedAggregateVersion),
        aggregateVersion: actualVersion,
      });
      if (!concurrency.allowed) {
        return {
          applied: false,
          reason: SESSION_ERROR_CODE.AGGREGATE_VERSION_CONFLICT,
          currentVersion: actualVersion,
        };
      }
      const result = commitTurnLifecycle({
        lifecycle: session.turnLifecycle,
        event: {
          ...lifecycleEvent,
          userId,
          sessionId,
          parentSessionId: resolvedParentSessionId,
        },
        eventOutbox: session.authorityEventOutbox,
        materializeTerminal: ({ terminalStatus, previousSummaryVersion }) =>
          materializeTurnTerminalMessages({
            messages: session.messages,
            terminalStatus,
            assistantMessage: lifecycleEvent.terminalStatus?.assistantMessage,
            previousSummaryVersion,
          }),
        createEventId: randomUUID,
        now: this.now,
      });
      if (!result.applied) {
        const userMessage = acceptedUserMessageInput
          ? (session.messages || []).find(
              (message) =>
                String(message?.role || "").trim() === "user" &&
                String(message?.turnScopeId || "").trim() ===
                  String(lifecycleEvent.turnScopeId || "").trim(),
            )
          : null;
        return {
          ...result,
          session,
          userMessage,
          dialogProcessId: String(result.turn?.dialogProcessId || "").trim(),
          aggregateVersion: actualVersion,
        };
      }
      session.turnLifecycle = result.lifecycle;
      const nowValue = this.now();
      const userMessage = materializeAcceptedUserMessage({
        session,
        event: lifecycleEvent,
        input: acceptedUserMessageInput,
        userId,
        sessionId,
        parentSessionId: resolvedParentSessionId,
        nowValue,
      });
      if (userMessage) session.aggregateVersion = concurrency.nextAggregateVersion;
      if (result.terminalMaterialization)
        session.messages = [...result.terminalMaterialization.messages];
      session.authorityEventOutbox = result.eventOutbox;
      session.updatedAt = nowValue;
      if (session.shortMemoryCheckpoint === undefined) session.shortMemoryCheckpoint = 0;
      await this.sessionRepo.save(userId, session, resolvedParentSessionId, {
        expectedAggregateVersion: actualVersion,
        persistenceContext,
      });
      // The display summary is the refresh read model. Persist it from the same
      // authoritative session state so lifecycle terminal transitions cannot
      // leave a stale processing snapshot behind.
      await this.sessionRepo.writeSessionDisplaySummary(userId, session, { persistenceContext });
      return {
        ...result,
        session,
        userMessage,
        dialogProcessId: String(result.turn?.dialogProcessId || "").trim(),
        turnStatus: result.turn?.terminalStatus || null,
        aggregateVersion: resolveAggregateVersion(session),
      };
    },
    parentSessionId,
    persistenceContext,
  );
}

export async function provisionSessionWithInitialTurn({
  userId,
  sessionId,
  parentSessionId = "",
  persistenceContext = null,
  expectedAggregateVersion,
  createSessionIfAbsent,
  ...event
} = {}) {
  const intent = validateSessionProvisionIntent({ ...event, createSessionIfAbsent });
  if (!intent.valid || !intent.requested)
    return { applied: false, reason: "invalid_session_provision_intent" };
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
      let session = await this.sessionRepo.findById(
        userId,
        sessionId,
        resolvedParentSessionId,
        persistenceContext,
      );
      const isNew = !session;
      if (isNew && (await this.sessionRepo.isSessionDeleted?.(userId, sessionId))) {
        return { applied: false, reason: "session_not_found" };
      }
      session ||=
        this.sessionRepo.createInitialSession?.({
          sessionId,
          parentSessionId: resolvedParentSessionId,
        }) ||
        normalizeSessionEntity(
          { sessionId, parentSessionId: resolvedParentSessionId, messages: [] },
          {
            now: this.now,
            sessionId,
            parentSessionId: resolvedParentSessionId,
          },
        );
      const { lifecycleEvent, acceptedUserMessageInput } = resolveTurnAcceptance(
        this,
        session,
        event,
      );
      const actualVersion = resolveAggregateVersion(session);
      if (
        expectedAggregateVersion !== undefined &&
        Number(expectedAggregateVersion) !== actualVersion
      ) {
        return {
          applied: false,
          reason: SESSION_ERROR_CODE.AGGREGATE_VERSION_CONFLICT,
          currentVersion: actualVersion,
        };
      }
      const result = commitTurnLifecycle({
        lifecycle: session.turnLifecycle,
        event: {
          ...lifecycleEvent,
          userId,
          sessionId,
          parentSessionId: resolvedParentSessionId,
        },
        eventOutbox: session.authorityEventOutbox,
        createEventId: randomUUID,
        now: this.now,
      });
      if (!result.applied) {
        const userMessage = acceptedUserMessageInput
          ? (session.messages || []).find(
              (message) =>
                String(message?.role || "").trim() === "user" &&
                String(message?.turnScopeId || "").trim() ===
                  String(lifecycleEvent.turnScopeId || "").trim(),
            )
          : null;
        return {
          ...result,
          session: isNew ? null : session,
          userMessage,
          dialogProcessId: String(result.turn?.dialogProcessId || "").trim(),
          aggregateVersion: actualVersion,
        };
      }
      session.turnLifecycle = result.lifecycle;
      const nowValue = this.now();
      const userMessage = materializeAcceptedUserMessage({
        session,
        event: lifecycleEvent,
        input: acceptedUserMessageInput,
        userId,
        sessionId,
        parentSessionId: resolvedParentSessionId,
        nowValue,
      });
      if (userMessage) session.aggregateVersion = actualVersion + 1;
      session.authorityEventOutbox = result.eventOutbox;
      session.updatedAt = nowValue;
      if (session.shortMemoryCheckpoint === undefined) session.shortMemoryCheckpoint = 0;
      const saved = await this.sessionRepo.save(userId, session, resolvedParentSessionId, {
        expectedAggregateVersion: isNew ? undefined : actualVersion,
        createOnly: isNew,
        persistenceContext,
      });
      if (saved === false) return { applied: false, reason: "session_not_found" };
      return {
        ...result,
        session,
        userMessage,
        dialogProcessId: String(result.turn?.dialogProcessId || "").trim(),
        aggregateVersion: resolveAggregateVersion(session),
        sessionCreated: isNew,
      };
    },
    parentSessionId,
    persistenceContext,
  );
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
    },
    parentSessionId,
    persistenceContext,
  );
}

export async function assertReusedUserTurnIdentity({
  userId,
  sessionId,
  parentSessionId = "",
  persistenceContext = null,
  turnScopeId = "",
  dialogProcessId = "",
  attachments = undefined,
} = {}) {
  if (!userId || !sessionId) throw new TypeError("reused Turn session identity is required");
  const normalizedTurnScopeId = String(turnScopeId || "").trim();
  if (!normalizedTurnScopeId) throw new TypeError("reused Turn turnScopeId is required");
  const normalizedDialogProcessId = normalizeDialogProcessId(dialogProcessId);
  if (!normalizedDialogProcessId) throw new TypeError("reused Turn dialogProcessId is required");
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
  if (!session) throw new TypeError("reused Turn session was not found");
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
  if (targetIndex < 0) throw new TypeError("reused Turn user message was not found");

  const targetMessage = messages[targetIndex];
  if (resolveContextMessageDialogProcessId(targetMessage) !== normalizedDialogProcessId) {
    throw new TypeError("reused Turn dialogProcessId does not match Session authority");
  }
  if (Array.isArray(attachments)) {
    const committedAttachments = dedupeAttachments(targetMessage.attachments);
    const preparedAttachments = dedupeAttachments(attachments);
    const immutableFields = [
      "attachmentId",
      "sessionId",
      "attachmentSource",
      "path",
      "relativePath",
      "contentSha256",
    ];
    const committedAttachmentIdentities = projectCanonicalAttachmentIdentities(
      committedAttachments,
      sessionId,
    );
    const preparedAttachmentIdentities = projectCanonicalAttachmentIdentities(
      preparedAttachments,
      sessionId,
    );
    if (
      JSON.stringify(committedAttachmentIdentities) !== JSON.stringify(preparedAttachmentIdentities)
    ) {
      throw new TypeError("reused Turn attachments do not match Session authority");
    }
    for (const [index, committed] of committedAttachments.entries()) {
      const prepared = preparedAttachments[index];
      for (const field of immutableFields) {
        if (String(committed?.[field] ?? "") !== String(prepared?.[field] ?? "")) {
          throw new TypeError("reused Turn attachments do not match Session authority");
        }
      }
    }
  }
  return {
    asserted: true,
    session,
    userMessage: targetMessage,
    messageIndex: targetIndex,
    aggregateVersion: resolveAggregateVersion(session),
    dialogProcessId: normalizedDialogProcessId,
  };
}
