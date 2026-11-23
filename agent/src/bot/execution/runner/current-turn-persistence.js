/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { emitEvent } from "../../../events/index.js";
import { text } from "@noobot/shared/value";
import { SESSION_ERROR_CODE } from "@noobot/session-protocol";
import { observeSessionStorageWork } from "../../../session/session-storage-observation.js";
import {
  createSessionChangesSubmission,
  requireMessagePersistenceReceipt,
} from "@noobot/session-protocol/session-changes";

function projectActivityDurability(activityMessages, durableMessages) {
  const durableByUid = new Map(durableMessages.map((item) => [item.messageUid, item]));
  return activityMessages.map((item = {}) => {
    const messageUid = text(item.messageUid);
    const expectedEventIds = item.activityTimeline
      .map((activity = {}) => text(activity.eventId))
      .filter(Boolean);
    const durable = durableByUid.get(messageUid);
    const durableEventIds = durable.activityEventIds;
    const durableEventSet = new Set(durableEventIds);
    const missingEventIds = expectedEventIds.filter((eventId) => !durableEventSet.has(eventId));
    return { messageUid, expectedEventIds, durableEventIds, missingEventIds };
  });
}

function assertMessagesDurable(messages, durableUids) {
  const missing = messages
    .map((message) => text(message.messageUid))
    .filter((messageUid) => !durableUids.has(messageUid));
  if (missing.length === 0) return;
  const error = new Error(`turn checkpoint messages were not persisted: ${missing.join(",")}`);
  error.code = SESSION_ERROR_CODE.TURN_MESSAGE_NOT_PERSISTED;
  error.missingMessageUids = missing;
  throw error;
}

function projectPersistedMessage(message = {}) {
  return {
    messageUid: text(message.messageUid),
    modelMessageId: text(message.modelMessageId),
    presentationMessageId: text(message.presentationMessageId),
    role: text(message.role),
    type: text(message.type),
    chatPresentation: message.chatPresentation === true,
    contentLength: typeof message.content === "string" ? message.content.length : 0,
    activityTimelineCount: Array.isArray(message.activityTimeline)
      ? message.activityTimeline.length
      : 0,
    toolTimelineCount: Array.isArray(message.toolTimeline) ? message.toolTimeline.length : 0,
    toolCallIds: Array.isArray(message.toolTimeline)
      ? message.toolTimeline.map((tool = {}) => text(tool.toolCallId)).filter(Boolean)
      : [],
    activityTimeline: Array.isArray(message.activityTimeline)
      ? message.activityTimeline.slice(0, 64).map((activity = {}) => ({
          eventId: text(activity.eventId),
          eventType: text(activity.eventType),
          activityKind: text(activity.activityKind),
          sequence: Number(activity.sequence || 0),
          sequenceDomain: text(activity.sequenceDomain),
          sequenceScopeId: text(activity.sequenceScopeId),
          authority: text(activity.authority),
        }))
      : [],
  };
}

function verifyPersistenceReceipts(
  messages,
  receipts,
  { sessionId, dialogProcessId, turnScopeId },
) {
  const submittedByUid = new Map(messages.map((item) => [item.messageUid, item]));
  const durableUids = new Set();
  for (const receipt of receipts) {
    requireMessagePersistenceReceipt(receipt);
    const source = submittedByUid.get(receipt.messageUid);
    if (
      !source ||
      durableUids.has(receipt.messageUid) ||
      receipt.sessionId !== sessionId ||
      receipt.dialogProcessId !== (source.dialogProcessId || dialogProcessId) ||
      receipt.turnScopeId !== (source.turnScopeId || turnScopeId)
    )
      throw new TypeError("Message persistence receipt ownership mismatch");
    durableUids.add(receipt.messageUid);
  }
  assertMessagesDurable(messages, durableUids);
}

function verifyActivityDurability(
  messages,
  receipts,
  { eventListener, sessionId, dialogProcessId, turnScopeId },
) {
  const activityMessages = messages.filter(
    (item = {}) =>
      text(item.messageUid) &&
      Array.isArray(item.activityTimeline) &&
      item.activityTimeline.length > 0,
  );
  const durableActivityMessages = projectActivityDurability(activityMessages, receipts);
  if (durableActivityMessages.some((item) => item.missingEventIds.length > 0)) {
    emitEvent(eventListener, "timeline_checkpoint_durability_mismatch", {
      sessionId,
      dialogProcessId,
      turnScopeId,
      messages: durableActivityMessages,
    });
    const error = new Error("canonical activity timeline was not durably persisted");
    error.code = "TIMELINE_CHECKPOINT_DURABILITY_MISMATCH";
    throw error;
  }
  return { activityMessages, durableActivityMessages };
}

async function appendPersistencePage({
  appendAgentMessages,
  store,
  context,
  entries,
  changes,
  submission,
}) {
  const messagesToPersist = entries.map((entry) => entry.message);
  const preparedAt = performance.now();
  const { result: persistedMessages, work: storageWork } = await observeSessionStorageWork(() =>
    appendAgentMessages({
      ...context,
      messages: messagesToPersist,
      changes,
      submission,
    }),
  );
  const appendedAt = performance.now();
  verifyPersistenceReceipts(messagesToPersist, persistedMessages, context);
  const activity = verifyActivityDurability(messagesToPersist, persistedMessages, context);
  store.confirmPersistence(entries, persistedMessages);
  store.acknowledgeChanges(entries);
  return { messagesToPersist, preparedAt, appendedAt, storageWork, ...activity };
}

async function collectPersistenceFailure(failures, operation) {
  try {
    await operation();
  } catch (error) {
    if (!failures.includes(error)) failures.push(error);
  }
}

export function bindCurrentTurnPersistence({
  dispatchRuntime,
  appendAgentMessages,
  commitSummaryCheckpoint,
  userId,
  sessionId,
  dialogProcessId,
  parentDialogProcessId,
  turnScopeId,
  eventListener,
  persistenceScope,
}) {
  let persistenceTail = Promise.resolve();
  let batchDepth = 0;
  let persistenceRequested = false;
  let pendingSubmission = null;
  const context = {
    userId,
    sessionId,
    dialogProcessId,
    parentDialogProcessId,
    turnScopeId,
    eventListener,
    persistenceScope,
  };

  const enqueue = (operation) => {
    const next = persistenceTail.then(operation);
    persistenceTail = next.then(
      () => undefined,
      () => undefined,
    );
    return next;
  };

  const persistPage = async (queuedAt, throughRevision) => {
    const startedAt = performance.now();
    const store = dispatchRuntime.currentTurnMessages;
    if (!pendingSubmission) {
      const batch = store.readPendingChangeBatch({
        throughRevision,
        ownership: { sessionId, dialogProcessId, turnScopeId },
      });
      if (!batch.entries.length) return false;
      pendingSubmission = { ...batch, submission: createSessionChangesSubmission() };
    }
    const { entries, changes, counts, submission } = pendingSubmission;
    const {
      messagesToPersist,
      preparedAt,
      appendedAt,
      storageWork,
      activityMessages,
      durableActivityMessages,
    } = await appendPersistencePage({
      appendAgentMessages,
      store,
      context,
      entries,
      changes,
      submission,
    });
    pendingSubmission = null;
    emitEvent(eventListener, "timeline_checkpoint_verified", {
      sessionId,
      dialogProcessId,
      turnScopeId,
      activityMessageCount: activityMessages.length,
      messages: durableActivityMessages,
    });
    emitEvent(eventListener, "timeline_checkpoint_persisted", {
      storageWork,
      durationMs: performance.now() - startedAt,
      queueWaitMs: startedAt - queuedAt,
      preparationMs: preparedAt - startedAt,
      appendMs: appendedAt - preparedAt,
      verificationMs: performance.now() - appendedAt,
      sessionId,
      dialogProcessId,
      parentDialogProcessId,
      turnScopeId,
      messageCount: counts.messageCount,
      persistedMessageCount: messagesToPersist.length,
      assistantCount: counts.assistantCount,
      toolCount: counts.toolCount,
      messages: messagesToPersist.map(projectPersistedMessage),
    });
    return true;
  };
  const persist = async (queuedAt) => {
    const throughRevision = dispatchRuntime.currentTurnMessages.readPersistenceBoundary();
    let hasPendingPage = true;
    while (hasPendingPage) {
      hasPendingPage = await persistPage(queuedAt, throughRevision);
    }
  };
  const enqueuePersistence = () => {
    const queuedAt = performance.now();
    return enqueue(() => persist(queuedAt));
  };

  dispatchRuntime.persistCurrentTurnMessages = () => {
    if (batchDepth > 0) {
      persistenceRequested = true;
      return Promise.resolve();
    }
    return enqueuePersistence();
  };
  dispatchRuntime.withCurrentTurnPersistenceBatch = async (operation) => {
    batchDepth += 1;
    const failures = [];
    let result;
    try {
      result = await operation();
    } catch (error) {
      failures.push(error);
    }
    batchDepth -= 1;
    if (batchDepth === 0 && persistenceRequested) {
      persistenceRequested = false;
      await collectPersistenceFailure(failures, enqueuePersistence);
    }
    if (failures.length === 1) throw failures[0];
    if (failures.length > 1)
      throw new AggregateError(failures, "Turn batch operation and persistence failed", {
        cause: failures[0],
      });
    return result;
  };
  dispatchRuntime.commitSummaryCheckpoint = (payload = {}) =>
    enqueue(async () => {
      if (pendingSubmission) await persist(performance.now());
      return commitSummaryCheckpoint({
        runtime: dispatchRuntime,
        userId,
        sessionId,
        dialogProcessId,
        parentDialogProcessId,
        turnScopeId,
        eventListener,
        persistenceScope,
        ...payload,
      });
    });
}
