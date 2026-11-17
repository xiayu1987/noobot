/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { randomUUID } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
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
import { copyCheckpointReceiptLists } from "@noobot/session-protocol/summary-checkpoint-storage";
import { normalizeMessageEntity } from "../../entities/message-entity.js";
import { registerSessionMessageFacts } from "../../entities/session-message-facts.js";
import { createSessionTurnLifecycleSnapshot } from "../../session-turn-read-model.js";
import { resolveDeletedSessionAs } from "./session-deleted-result.js";
import { text } from "@noobot/shared/value";
import { SESSION_CALLER } from "@noobot/shared/session-caller";
import { readImmutableTurnMutationSource } from "./immutable-turn-source.js";

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
        session: rejectedSession === null ? null : copyCheckpointReceiptLists(rejectedSession),
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

async function commitImmutableTurnState(
  service,
  reader,
  scope,
  { userId, sessionId, expectedAggregateVersion, sessionCaller, event },
  commitChanges,
) {
  const session = await readImmutableTurnMutationSource(reader, event);
  const { lifecycleEvent, acceptedUserMessageInput } = resolveTurnAcceptance(
    service,
    session,
    event,
    sessionCaller,
  );
  const { actualVersion, nextAggregateVersion, conflict } = resolveTurnAggregateConcurrency(
    session,
    expectedAggregateVersion,
  );
  if (conflict) return conflict;
  const existing = findTurnScopeUserMessage(session, event.turnScopeId);
  const userMessage = materializeAcceptedUserMessage({
    session,
    event: lifecycleEvent,
    turn: { dialogProcessId: lifecycleEvent.dialogProcessId },
    input: acceptedUserMessageInput,
    userId,
    sessionId,
    parentSessionId: scope.resolvedParentSessionId,
    nowValue: service.now(),
  });
  const committed = await commitChanges({
    expectedGeneration: reader.generation,
    operationId: randomUUID(),
    changes: {
      turnTransition: { ...lifecycleEvent, userId, sessionId },
      messages: userMessage && !existing ? [userMessage] : [],
    },
    committedAt: service.now(),
  });
  const transition = committed.aborted ? committed.result : committed.result.turnTransition;
  if (!transition.applied) {
    if (!existing) session.messages = [];
    return {
      ...transition,
      session,
      userMessage: existing,
      dialogProcessId: text(transition.turn?.dialogProcessId),
      aggregateVersion: actualVersion,
    };
  }
  session.turnLifecycle = {
    ...session.turnLifecycle,
    ...transition.header,
    turns: {
      ...session.turnLifecycle.turns,
      ...Object.fromEntries(transition.changedTurns.map((turn) => [turn.turnScopeId, turn])),
    },
    commandReceipts: [transition.commandReceipt],
  };
  session.updatedAt = transition.turn.updatedAt;
  if (userMessage && !existing) session.aggregateVersion = nextAggregateVersion;
  return {
    ...transition,
    lifecycle: session.turnLifecycle,
    session,
    userMessage,
    dialogProcessId: text(transition.turn?.dialogProcessId),
    turnStatus: transition.turn?.terminalStatus || null,
    aggregateVersion: session.aggregateVersion,
  };
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
  const session = await this.sessionRepo.findTurnTerminalSource(userId, sessionId, {
    persistenceContext,
    terminalLimit,
  });
  if (!session) return { found: false, reason: SESSION_NOT_FOUND_REASON };
  const recovery = await resolveRecovery(selectAuthoritativeActiveTurn(session.turnLifecycle));
  return {
    found: true,
    snapshot: createSessionTurnLifecycleSnapshot({
      session,
      messageTurnScopeIds: session.messageTurnScopeIds,
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
  initialSessionMetadata,
  ...event
}) {
  if (!userId || !sessionId) return { applied: false, reason: "missing_session" };
  const provisionIntent = validateSessionProvisionIntent({
    ...event,
    createSessionIfAbsent,
    sessionCaller,
    initialSessionMetadata,
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
      initialSessionMetadata,
      ...event,
    });
  }
  const mutation = this.sessionRepo.withSessionReader(
    userId,
    sessionId,
    async (reader, scope, commitChanges) => {
      return await commitImmutableTurnState(
        this,
        reader,
        scope,
        { userId, sessionId, expectedAggregateVersion, sessionCaller, event },
        commitChanges,
      );
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
  initialSessionMetadata = null,
  ...event
}) {
  const mutation = this.sessionRepo.withSessionPlacementMutation(
    userId,
    { sessionId, parentSessionId },
    async (scope) => {
      await using reader = await this.sessionRepo.recoverImmutableSessionPlacement(
        userId,
        sessionId,
        {
          scope,
          persistenceContext,
        },
      );
      if (reader) {
        if (!isDeepStrictEqual(await reader.readScopedMetadata(), initialSessionMetadata)) {
          return {
            applied: false,
            reason: "initial_session_metadata_conflict",
            sessionCreated: false,
          };
        }
        const result = await commitImmutableTurnState(
          this,
          reader,
          scope,
          { userId, sessionId, expectedAggregateVersion, sessionCaller, event },
          (request) =>
            this.sessionRepo.commitChanges(userId, sessionId, {
              ...request,
              persistenceContext,
            }),
        );
        return { ...result, sessionCreated: false };
      }
      const resolvedParentSessionId = scope.resolvedParentSessionId;
      if (await this.sessionRepo.isSessionDeleted(userId, sessionId)) {
        return { applied: false, reason: SESSION_DELETED_REASON };
      }
      const session = this.sessionRepo.createInitialSession({
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
      const result = commitTurnLifecycle({
        lifecycle: session.turnLifecycle,
        event: { ...lifecycleEvent, userId, sessionId },
        parentSessionId: resolvedParentSessionId,
        isCommittedEventId: () => false,
        readPreparedEvent: () => {
          throw new Error("A new session cannot reference a prepared lifecycle event");
        },
        createEventId: randomUUID,
        now: this.now,
      });
      const { rejected, userMessage, nowValue } = acceptCommittedTurn({
        service: this,
        result,
        session,
        rejectedSession: null,
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
      await this.sessionRepo.createImmutableSession(userId, session, {
        sessionId,
        scope,
        persistenceContext,
        authorityEvents: [{ ...result.committedEvent, deliveries: {} }],
        scopedMetadata: initialSessionMetadata,
      });
      return {
        ...result,
        session: copyCheckpointReceiptLists(session),
        userMessage,
        dialogProcessId: text(result.turn?.dialogProcessId),
        aggregateVersion: requireSessionAggregateVersion(session?.aggregateVersion),
        sessionCreated: true,
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
  return this.sessionRepo.withSessionReader(
    userId,
    sessionId,
    async (reader, _scope, commitChanges) => {
      const session = await readImmutableTurnMutationSource(reader, { turnScopeId });
      const before = JSON.stringify(session.turnTimings);
      upsertSessionTurnTiming(session, {
        turnScopeId,
        dialogProcessId,
        thinkingFinishedAt,
        modelLoopRound,
      });
      if (JSON.stringify(session.turnTimings) === before)
        return { upserted: false, reason: "unchanged", session };
      const committedAt = this.now();
      await commitChanges({
        expectedGeneration: reader.generation,
        operationId: randomUUID(),
        changes: { timings: session.turnTimings },
        committedAt,
      });
      session.updatedAt = committedAt;
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
  await using reader = await this.sessionRepo.requireSessionReader(userId, sessionId, {
    persistenceContext,
  });
  const session = await readImmutableTurnMutationSource(reader, {
    turnScopeId: normalizedTurnScopeId,
  });
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
    session: copyCheckpointReceiptLists(session),
    userMessage: targetMessage,
    messageIndex: targetIndex,
    aggregateVersion: requireSessionAggregateVersion(session?.aggregateVersion),
    dialogProcessId: normalizedDialogProcessId,
  };
}
