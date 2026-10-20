/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { isInjectedOrPluginMessage } from "@noobot/context-protocol/policy/message";
import { resolveContextMessageDialogProcessId } from "@noobot/context-protocol/message/codec";
import { randomUUID } from "node:crypto";
import { projectCanonicalAttachmentIdentities } from "../../../artifacts/index.js";
import { dedupeAttachments } from "./attachment-helpers.js";
import { upsertSessionTurnTiming } from "./turn-timing.js";
import { commitTurnLifecycle } from "@noobot/authoritative-state/application";
import {
  SESSION_ERROR_CODE,
  TURN_EVENT,
  assertTurnAcceptanceUserMessage,
  decideAggregateConcurrency,
  materializeTurnTerminalMessages,
  normalizeDialogProcessId,
  requireTurnCommitAction,
  validateSessionProvisionIntent,
  requireSessionAggregateVersion,
  SESSION_NOT_FOUND_REASON,
} from "@noobot/session-protocol";
import { createSessionMessageUid } from "../../../context/session/message-uid.js";
import { normalizeMessageEntity } from "../../entities/message-entity.js";
import { registerSessionMessageFacts } from "../../entities/session-message-facts.js";
import { createSessionTurnLifecycleSnapshot } from "../../session-turn-read-model.js";
import {
  appendAuthorityOutboxRecords,
  authorityOutboxCommitRecord,
  readCommittedAuthorityEventIds,
  withAuthorityOutboxMutation,
} from "../../authority-outbox-store/outbox-journal.js";
import { resolveDeletedSessionAs } from "./session-deleted-result.js";
import { text, isPlainObject } from "@noobot/shared/value";

function bindTerminalAssistantIdentity(session, turnScopeId, assistantMessage) {
  if (!isPlainObject(assistantMessage)) return assistantMessage;
  const clean = (value) => text(value);
  const turn = session?.turnLifecycle?.turns?.[clean(turnScopeId)] || {};
  return normalizeMessageEntity({
    ...assistantMessage,
    messageUid: clean(assistantMessage.messageUid) || createSessionMessageUid(),
    presentationMessageId:
      clean(assistantMessage.presentationMessageId) || clean(turn.presentationMessageId),
  });
}

async function appendCommittedTurnLifecycleEvent(sessionDir, committedEvent) {
  const eventId = text(committedEvent?.eventId);
  if (!sessionDir || !eventId) return;
  await withAuthorityOutboxMutation(sessionDir, () =>
    appendAuthorityOutboxRecords(sessionDir, [authorityOutboxCommitRecord(committedEvent)]),
  );
}

function validateAcceptedUserMessage(event = {}) {
  const validation = assertTurnAcceptanceUserMessage(event);
  return validation.materialize ? validation.value : null;
}

function resolveTurnAcceptance(service, session, event = {}) {
  const lifecycleEvent = { ...event };
  if (
    text(lifecycleEvent.eventType) === TURN_EVENT.ACTION_ACCEPTED &&
    text(lifecycleEvent.action) !== "resend" &&
    !text(lifecycleEvent.dialogProcessId)
  ) {
    const turnScopeId = text(lifecycleEvent.turnScopeId);
    const existingDialogProcessId = text(
      session?.turnLifecycle?.turns?.[turnScopeId]?.dialogProcessId,
    );
    lifecycleEvent.dialogProcessId =
      existingDialogProcessId || String(service.allocateDialogProcessId()).trim();
  }
  return {
    lifecycleEvent,
    acceptedUserMessageInput: validateAcceptedUserMessage(lifecycleEvent),
  };
}

function findTurnScopeUserMessage(session, turnScopeId) {
  const scope = text(turnScopeId);
  return (
    session.messages.find(
      (message) => text(message?.role) === "user" && text(message?.turnScopeId) === scope,
    ) || null
  );
}

function resolveTurnAggregateConcurrency(session, expectedAggregateVersion) {
  const actualVersion = requireSessionAggregateVersion(session?.aggregateVersion);
  const concurrency = decideAggregateConcurrency({
    expectedAggregateVersion:
      expectedAggregateVersion === undefined ? null : Number(expectedAggregateVersion),
    aggregateVersion: actualVersion,
  });
  return {
    actualVersion,
    nextAggregateVersion: concurrency.nextAggregateVersion,
    conflict: concurrency.allowed
      ? null
      : {
          applied: false,
          reason: SESSION_ERROR_CODE.AGGREGATE_VERSION_CONFLICT,
          currentVersion: actualVersion,
        },
  };
}

async function commitTurnLifecycleWithOutbox({
  service,
  userId,
  sessionId,
  scope,
  session,
  lifecycleEvent,
  materializeTerminal = null,
}) {
  const outboxSessionDir = scope.sessionDir;
  const committedEventIds = await readCommittedAuthorityEventIds(outboxSessionDir);
  const result = commitTurnLifecycle({
    lifecycle: session.turnLifecycle,
    event: {
      ...lifecycleEvent,
      userId,
      sessionId,
      parentSessionId: scope.resolvedParentSessionId,
    },
    isCommittedEventId: (eventId) => committedEventIds.has(eventId),
    ...(materializeTerminal ? { materializeTerminal } : {}),
    createEventId: randomUUID,
    now: service.now,
  });
  return { outboxSessionDir, result };
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
  const existing = findTurnScopeUserMessage(session, event.turnScopeId);
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
      dialogProcessId: text(event.dialogProcessId),
      parentDialogProcessId: input.parentDialogProcessId,
      turnScopeId: text(event.turnScopeId),
      messageOrigin: text(input.messageOrigin).toLowerCase(),
      userMetaMaterialized: input.userMetaMaterialized === true,
      attachments: [],
      turnCommit: {
        action: requireTurnCommitAction(event.action),
        commandId: text(event.causationId),
        ...(event.continuationSource
          ? {
              resumeDialogProcessId: text(event.continuationSource.dialogProcessId),
              resumeTurnScopeId: text(event.continuationSource.turnScopeId),
            }
          : {}),
      },
      ts: nowValue,
    },
    () => nowValue,
  );
  session.messages = [...session.messages, userMessage];
  registerSessionMessageFacts(session, userMessage);
  return userMessage;
}

function acceptCommittedTurn({
  service,
  result,
  session,
  rejectedSession,
  lifecycleEvent,
  acceptedUserMessageInput,
  actualVersion,
  nextAggregateVersion,
  userId,
  sessionId,
  resolvedParentSessionId,
}) {
  if (!result.applied) {
    const userMessage = acceptedUserMessageInput
      ? findTurnScopeUserMessage(session, lifecycleEvent.turnScopeId)
      : null;
    return {
      rejected: {
        ...result,
        session: rejectedSession,
        userMessage,
        dialogProcessId: text(result.turn?.dialogProcessId),
        aggregateVersion: actualVersion,
      },
    };
  }
  session.turnLifecycle = result.lifecycle;
  const nowValue = service.now();
  const userMessage = materializeAcceptedUserMessage({
    session,
    event: lifecycleEvent,
    input: acceptedUserMessageInput,
    userId,
    sessionId,
    parentSessionId: resolvedParentSessionId,
    nowValue,
  });
  if (userMessage) session.aggregateVersion = nextAggregateVersion;
  return { userMessage, nowValue };
}

export async function getTurnLifecycleSnapshot({
  userId,
  sessionId,
  persistenceContext,
  commandId = "",
  knownSequence,
  terminalLimit,
} = {}) {
  if (!userId || !sessionId) return { found: false, reason: "missing_session" };
  const session = await this.sessionRepo.findById(userId, sessionId, { persistenceContext });
  if (!session) return { found: false, reason: SESSION_NOT_FOUND_REASON };
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

export async function applyTurnLifecycleEvent({
  userId,
  sessionId,
  persistenceContext,
  expectedAggregateVersion,
  sessionCaller,
  ...event
} = {}) {
  if (!userId || !sessionId) return { applied: false, reason: "missing_session" };
  const provisionIntent = validateSessionProvisionIntent({ ...event, sessionCaller });
  if (!provisionIntent.valid) return { applied: false, reason: "invalid_session_provision_intent" };
  if (provisionIntent.requested) {
    return provisionSessionWithInitialTurn.call(this, {
      userId,
      sessionId,
      persistenceContext,
      expectedAggregateVersion,
      sessionCaller,
      ...event,
    });
  }
  const mutation = this.sessionRepo.withSessionMutation(
    userId,
    sessionId,
    async (scope) => {
      const session = await this.sessionRepo.findById(userId, sessionId, { persistenceContext });
      const resolvedParentSessionId = scope.resolvedParentSessionId;
      if (!session) return { applied: false, reason: SESSION_NOT_FOUND_REASON };
      const { lifecycleEvent, acceptedUserMessageInput } = resolveTurnAcceptance(
        this,
        session,
        event,
      );
      const { actualVersion, nextAggregateVersion, conflict } = resolveTurnAggregateConcurrency(
        session,
        expectedAggregateVersion,
      );
      if (conflict) return conflict;
      const terminalAssistantMessage = bindTerminalAssistantIdentity(
        session,
        lifecycleEvent.turnScopeId,
        lifecycleEvent.terminalStatus?.assistantMessage,
      );
      const { outboxSessionDir, result } = await commitTurnLifecycleWithOutbox({
        service: this,
        userId,
        sessionId,
        scope,
        session,
        lifecycleEvent,
        materializeTerminal: ({ terminalStatus, previousSummaryVersion }) =>
          materializeTurnTerminalMessages({
            messages: session.messages,
            terminalStatus,
            assistantMessage: terminalAssistantMessage,
            previousSummaryVersion,
          }),
      });
      const { rejected, userMessage, nowValue } = acceptCommittedTurn({
        service: this,
        result,
        session,
        rejectedSession: session,
        lifecycleEvent,
        acceptedUserMessageInput,
        actualVersion,
        nextAggregateVersion,
        userId,
        sessionId,
        resolvedParentSessionId,
      });
      if (rejected) return rejected;
      if (result.terminalMaterialization)
        session.messages = [...result.terminalMaterialization.messages];
      session.updatedAt = nowValue;
      await this.sessionRepo.save(userId, session, {
        expectedAggregateVersion: actualVersion,
        persistenceContext,
      });
      await appendCommittedTurnLifecycleEvent(outboxSessionDir, result.committedEvent);
      return {
        ...result,
        session,
        userMessage,
        dialogProcessId: text(result.turn?.dialogProcessId),
        turnStatus: result.turn?.terminalStatus || null,
        aggregateVersion: requireSessionAggregateVersion(session?.aggregateVersion),
      };
    },
    { persistenceContext },
  );
  return resolveDeletedSessionAs(mutation, { applied: false });
}

async function provisionSessionWithInitialTurn({
  userId,
  sessionId,
  parentSessionId,
  persistenceContext,
  expectedAggregateVersion,
  createSessionIfAbsent,
  sessionCaller,
  ...event
} = {}) {
  const intent = validateSessionProvisionIntent({ ...event, createSessionIfAbsent, sessionCaller });
  if (!intent.valid || !intent.requested)
    return { applied: false, reason: "invalid_session_provision_intent" };
  const mutation = this.sessionRepo.withSessionPlacementMutation(
    userId,
    { sessionId, parentSessionId },
    async (scope) => {
      const found = await this.sessionRepo.findById(userId, sessionId, { persistenceContext });
      const resolvedParentSessionId = scope.resolvedParentSessionId;
      const isNew = !found;
      if (isNew && (await this.sessionRepo.isSessionDeleted(userId, sessionId))) {
        return { applied: false, reason: SESSION_NOT_FOUND_REASON };
      }
      const session =
        found ||
        this.sessionRepo.createInitialSession({
          sessionId,
          parentSessionId: resolvedParentSessionId,
          caller: sessionCaller,
        });
      const { lifecycleEvent, acceptedUserMessageInput } = resolveTurnAcceptance(
        this,
        session,
        event,
      );
      const { actualVersion, nextAggregateVersion, conflict } = resolveTurnAggregateConcurrency(
        session,
        expectedAggregateVersion,
      );
      if (conflict) return conflict;
      const { outboxSessionDir, result } = await commitTurnLifecycleWithOutbox({
        service: this,
        userId,
        sessionId,
        scope,
        session,
        lifecycleEvent,
      });
      const { rejected, userMessage, nowValue } = acceptCommittedTurn({
        service: this,
        result,
        session,
        rejectedSession: isNew ? null : session,
        lifecycleEvent,
        acceptedUserMessageInput,
        actualVersion,
        nextAggregateVersion,
        userId,
        sessionId,
        resolvedParentSessionId,
      });
      if (rejected) return rejected;
      session.updatedAt = nowValue;
      const saved = await this.sessionRepo.save(userId, session, {
        expectedAggregateVersion: isNew ? undefined : actualVersion,
        createOnly: isNew,
        persistenceContext,
      });
      if (saved === false) return { applied: false, reason: SESSION_NOT_FOUND_REASON };
      await appendCommittedTurnLifecycleEvent(outboxSessionDir, result.committedEvent);
      return {
        ...result,
        session,
        userMessage,
        dialogProcessId: text(result.turn?.dialogProcessId),
        aggregateVersion: requireSessionAggregateVersion(session?.aggregateVersion),
        sessionCreated: isNew,
      };
    },
    { persistenceContext },
  );
  return resolveDeletedSessionAs(mutation, { applied: false });
}

export async function upsertTurnTiming({
  userId,
  sessionId,
  persistenceContext,
  turnScopeId = "",
  dialogProcessId = "",
  thinkingStartedAt = "",
  thinkingFinishedAt = "",
  modelLoopRound = 0,
} = {}) {
  if (!userId || !sessionId) return { upserted: false, reason: "missing_session" };
  const mutation = this.sessionRepo.withSessionMutation(
    userId,
    sessionId,
    async () => {
      const session = await this.sessionRepo.findById(userId, sessionId, { persistenceContext });
      if (!session) return { upserted: false, reason: SESSION_NOT_FOUND_REASON };
      const before = JSON.stringify(session.turnTimings);
      upsertSessionTurnTiming(session, {
        turnScopeId,
        dialogProcessId,
        thinkingStartedAt,
        thinkingFinishedAt,
        modelLoopRound,
      });
      if (JSON.stringify(session.turnTimings) === before) {
        return { upserted: false, reason: "unchanged", session };
      }
      session.updatedAt = this.now();
      await this.sessionRepo.save(userId, session, { persistenceContext });
      return { upserted: true, session };
    },
    { persistenceContext },
  );
  return resolveDeletedSessionAs(mutation, { upserted: false });
}

export async function assertReusedUserTurnIdentity({
  userId,
  sessionId,
  persistenceContext,
  turnScopeId = "",
  dialogProcessId = "",
  attachments = undefined,
} = {}) {
  if (!userId || !sessionId) throw new TypeError("reused Turn session identity is required");
  const normalizedTurnScopeId = text(turnScopeId);
  if (!normalizedTurnScopeId) throw new TypeError("reused Turn turnScopeId is required");
  const normalizedDialogProcessId = normalizeDialogProcessId(dialogProcessId);
  if (!normalizedDialogProcessId) throw new TypeError("reused Turn dialogProcessId is required");
  const session = await this.sessionRepo.findById(userId, sessionId, { persistenceContext });
  if (!session) throw new TypeError("reused Turn session was not found");
  const messages = session.messages;
  const targetIndex = (() => {
    for (let index = messages.length - 1; index >= 0; index -= 1) {
      const messageItem = messages[index];
      if (text(messageItem?.role) !== "user") continue;
      if (text(messageItem?.turnScopeId) !== normalizedTurnScopeId) continue;
      if (isInjectedOrPluginMessage(messageItem)) continue;
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
    aggregateVersion: requireSessionAggregateVersion(session?.aggregateVersion),
    dialogProcessId: normalizedDialogProcessId,
  };
}
