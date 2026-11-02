/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { randomUUID } from "node:crypto";
import { projectCanonicalAttachmentIdentities } from "../../../artifacts/index.js";
import { dedupeAttachments } from "./attachment-helpers.js";
import { upsertSessionTurnTiming } from "./turn-timing.js";
import {
  commitTurnLifecycle,
  selectAuthoritativeActiveTurn,
} from "@noobot/authoritative-state/application";
import {
  SESSION_ERROR_CODE,
  assertTurnAcceptanceUserMessage,
  decideAggregateConcurrency,
  materializeTurnTerminalMessages,
  normalizeDialogProcessId,
  requireTurnCommitAction,
  validateSessionProvisionIntent,
  validateTurnLifecycleRequest,
  requireSessionAggregateVersion,
  SESSION_DELETED_REASON,
  SESSION_NOT_FOUND_REASON,
  isInjectedOrPluginSessionMessageRecord,
  resolveSessionMessageRecordDialogProcessId,
} from "@noobot/session-protocol";
import { createMessageUid } from "@noobot/session-protocol/message-identity";
import { normalizeMessageEntity } from "../../entities/message-entity.js";
import { registerSessionMessageFacts } from "../../entities/session-message-facts.js";
import { createSessionTurnLifecycleSnapshot } from "../../session-turn-read-model.js";
import {
  materializeCommittedTurnEvents,
  readCommittedAuthorityEventIds,
} from "../../authority-outbox-store/outbox-journal.js";
import { resolveDeletedSessionAs } from "./session-deleted-result.js";
import { text } from "@noobot/shared/value";
import { SESSION_CALLER } from "@noobot/shared/session-caller";

function validateAcceptedUserMessage(event) {
  const validation = assertTurnAcceptanceUserMessage(event);
  return validation.materialize ? validation.value : null;
}

function resolveTurnAcceptance(service, session, event, sessionCaller) {
  const acceptedUserMessageInput = validateAcceptedUserMessage({ ...event, sessionCaller });
  const lifecycleEvent = { ...event };
  if (
    acceptedUserMessageInput &&
    sessionCaller === SESSION_CALLER.USER &&
    !session.turnLifecycle.turns[lifecycleEvent.turnScopeId]
  ) {
    lifecycleEvent.dialogProcessId = service.allocateDialogProcessId();
  }
  return { lifecycleEvent, acceptedUserMessageInput };
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
    event: { ...lifecycleEvent, userId, sessionId },
    parentSessionId: scope.resolvedParentSessionId,
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
  turn,
  input,
  userId,
  sessionId,
  parentSessionId,
  nowValue,
}) {
  if (!input) return null;
  const existing = findTurnScopeUserMessage(session, event.turnScopeId);
  if (existing) return existing;
  const userMessage = normalizeMessageEntity({
    messageUid: createMessageUid(),
    userMessageId: input.userMessageId,
    role: "user",
    type: "message",
    content: input.content,
    userName: String(userId),
    sessionId,
    parentSessionId,
    dialogProcessId: turn.dialogProcessId,
    parentDialogProcessId: input.parentDialogProcessId,
    turnScopeId: text(event.turnScopeId),
    messageOrigin: input.messageOrigin,
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
  });
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
    turn: result.turn,
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
  commandId,
  knownSequence,
  terminalLimit,
  resolveRecovery,
}) {
  if (!userId || !sessionId) return { found: false, reason: "missing_session" };
  const session = await this.sessionRepo.findById(userId, sessionId, { persistenceContext });
  if (!session) return { found: false, reason: SESSION_NOT_FOUND_REASON };
  const recovery = await resolveRecovery(selectAuthoritativeActiveTurn(session.turnLifecycle));
  return {
    found: true,
    snapshot: createSessionTurnLifecycleSnapshot({
      session,
      commandId,
      knownSequence,
      terminalLimit,
      recovery,
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
  createSessionIfAbsent,
  parentSessionId,
  ...event
}) {
  if (!userId || !sessionId) return { applied: false, reason: "missing_session" };
  const provisionIntent = validateSessionProvisionIntent({
    ...event,
    createSessionIfAbsent,
    sessionCaller,
  });
  if (!provisionIntent.valid) return { applied: false, reason: "invalid_session_provision_intent" };
  const requestFailure = validateTurnLifecycleRequest(event);
  if (requestFailure) return { applied: false, reason: requestFailure };
  if (provisionIntent.requested) {
    return provisionSessionWithInitialTurn.call(this, {
      userId,
      sessionId,
      persistenceContext,
      expectedAggregateVersion,
      sessionCaller,
      createSessionIfAbsent,
      parentSessionId,
      ...event,
    });
  }
  const mutation = this.sessionRepo.withSessionMutation(
    userId,
    sessionId,
    async (scope) => {
      const session = await this.sessionRepo.requireById(userId, sessionId, { persistenceContext });
      const resolvedParentSessionId = scope.resolvedParentSessionId;
      const { lifecycleEvent, acceptedUserMessageInput } = resolveTurnAcceptance(
        this,
        session,
        event,
        sessionCaller,
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
        materializeTerminal: ({ terminalStatus, previousSummaryVersion }) =>
          materializeTurnTerminalMessages({
            messages: session.messages,
            terminalStatus,
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
      await materializeCommittedTurnEvents(outboxSessionDir, result.lifecycle);
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
}) {
  const mutation = this.sessionRepo.withSessionPlacementMutation(
    userId,
    { sessionId, parentSessionId },
    async (scope) => {
      const found = await this.sessionRepo.findById(userId, sessionId, { persistenceContext });
      const resolvedParentSessionId = scope.resolvedParentSessionId;
      const isNew = !found;
      if (isNew && (await this.sessionRepo.isSessionDeleted(userId, sessionId))) {
        return { applied: false, reason: SESSION_DELETED_REASON };
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
        sessionCaller,
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
      await this.sessionRepo.save(userId, session, {
        expectedAggregateVersion: isNew ? undefined : actualVersion,
        createOnly: isNew,
        persistenceContext,
      });
      await materializeCommittedTurnEvents(outboxSessionDir, result.lifecycle);
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
  turnScopeId,
  dialogProcessId,
  thinkingFinishedAt,
  modelLoopRound,
}) {
  return this.sessionRepo.withSessionMutation(
    userId,
    sessionId,
    async () => {
      const session = await this.sessionRepo.requireById(userId, sessionId, { persistenceContext });
      const before = JSON.stringify(session.turnTimings);
      upsertSessionTurnTiming(session, {
        turnScopeId,
        dialogProcessId,
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
}

function assertReusedTurnAttachments({ committed, prepared, sessionId }) {
  const committedAttachments = dedupeAttachments(committed);
  const preparedAttachments = dedupeAttachments(prepared);
  const committedIdentities = projectCanonicalAttachmentIdentities(committedAttachments, sessionId);
  const preparedIdentities = projectCanonicalAttachmentIdentities(preparedAttachments, sessionId);
  if (JSON.stringify(committedIdentities) !== JSON.stringify(preparedIdentities)) {
    throw new TypeError("reused Turn attachments do not match Session authority");
  }
  const immutableFields = [
    "attachmentId",
    "sessionId",
    "attachmentSource",
    "path",
    "relativePath",
    "contentSha256",
  ];
  const changed = committedAttachments.some((attachment, index) =>
    immutableFields.some(
      (field) =>
        String(attachment?.[field] ?? "") !== String(preparedAttachments[index]?.[field] ?? ""),
    ),
  );
  if (changed) throw new TypeError("reused Turn attachments do not match Session authority");
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
  const session = await this.sessionRepo.requireById(userId, sessionId, { persistenceContext });
  const messages = session.messages;
  const targetIndex = (() => {
    for (let index = messages.length - 1; index >= 0; index -= 1) {
      const messageItem = messages[index];
      if (text(messageItem?.role) !== "user") continue;
      if (text(messageItem?.turnScopeId) !== normalizedTurnScopeId) continue;
      if (isInjectedOrPluginSessionMessageRecord(messageItem)) continue;
      return index;
    }
    return -1;
  })();
  if (targetIndex < 0) throw new TypeError("reused Turn user message was not found");

  const targetMessage = messages[targetIndex];
  if (resolveSessionMessageRecordDialogProcessId(targetMessage) !== normalizedDialogProcessId) {
    throw new TypeError("reused Turn dialogProcessId does not match Session authority");
  }
  if (Array.isArray(attachments)) {
    assertReusedTurnAttachments({
      committed: targetMessage.attachments,
      prepared: attachments,
      sessionId,
    });
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
