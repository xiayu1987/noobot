/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { emitEvent } from "../../../events/index.js";
import { text } from "@noobot/shared/value";

function checkpointKey(message = {}, index = 0) {
  const messageUid = text(message?.messageUid);
  if (messageUid) return `uid:${messageUid}`;
  return `index:${index}:${String(message?.role || "")}:${String(message?.tool_call_id || "")}`;
}

function checkpointFingerprint(message = {}) {
  try {
    return JSON.stringify(message);
  } catch {
    return null;
  }
}

function buildCheckpointEntries(messages = []) {
  return messages.map((message, index) => ({
    key: checkpointKey(message, index),
    fingerprint: checkpointFingerprint(message),
    message,
  }));
}

function projectActivityDurability(activityMessages, durableMessages) {
  const durableByUid = new Map(
    (Array.isArray(durableMessages) ? durableMessages : [])
      .map((item = {}) => [text(item.messageUid), item])
      .filter(([messageUid]) => messageUid),
  );
  return activityMessages.map((item = {}) => {
    const messageUid = text(item.messageUid);
    const expectedEventIds = item.activityTimeline
      .map((activity = {}) => text(activity.eventId))
      .filter(Boolean);
    const durable = durableByUid.get(messageUid);
    const durableEventIds = (
      Array.isArray(durable?.activityTimeline) ? durable.activityTimeline : []
    )
      .map((activity = {}) => text(activity.eventId))
      .filter(Boolean);
    const missingEventIds = expectedEventIds.filter(
      (eventId) => !durableEventIds.includes(eventId),
    );
    return { messageUid, expectedEventIds, durableEventIds, missingEventIds };
  });
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
  const persistedFingerprints = new Map();

  const enqueuePersistence = () => {
    const persist = async () => {
      const messages = dispatchRuntime.currentTurnMessages.toArray();
      if (!messages.length) return;
      const checkpointEntries = buildCheckpointEntries(messages);
      const changedEntries = checkpointEntries.filter(
        ({ key, fingerprint }) =>
          fingerprint === null || persistedFingerprints.get(key) !== fingerprint,
      );
      const messagesToPersist = changedEntries.map(({ message }) => message);
      if (!messagesToPersist.length) {
        dispatchRuntime.timelineCheckpointPersistedMessageUids = messages
          .map((item = {}) => text(item.messageUid))
          .filter(Boolean);
        return;
      }
      const persistedMessages = await appendAgentMessages({
        userId,
        sessionId,
        messages: messagesToPersist,
        dialogProcessId,
        parentDialogProcessId,
        turnScopeId,
        eventListener,
        persistenceScope,
      });
      const activityMessages = messagesToPersist.filter(
        (item = {}) =>
          text(item.messageUid) &&
          Array.isArray(item.activityTimeline) &&
          item.activityTimeline.length > 0,
      );
      let durableActivityMessages = [];
      if (activityMessages.length > 0) {
        durableActivityMessages = projectActivityDurability(activityMessages, persistedMessages);
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
      }
      const currentKeys = new Set(checkpointEntries.map(({ key }) => key));
      for (const key of persistedFingerprints.keys()) {
        if (!currentKeys.has(key)) persistedFingerprints.delete(key);
      }
      for (const { key, fingerprint } of changedEntries) {
        if (fingerprint !== null) persistedFingerprints.set(key, fingerprint);
      }
      dispatchRuntime.timelineCheckpointPersistedMessageUids = messages
        .map((item = {}) => text(item.messageUid))
        .filter(Boolean);
      emitEvent(eventListener, "timeline_checkpoint_verified", {
        sessionId,
        dialogProcessId,
        turnScopeId,
        activityMessageCount: activityMessages.length,
        messages: durableActivityMessages,
      });
      emitEvent(eventListener, "timeline_checkpoint_persisted", {
        sessionId,
        dialogProcessId,
        parentDialogProcessId,
        turnScopeId,
        messageCount: messages.length,
        persistedMessageCount: messagesToPersist.length,
        assistantCount: messages.filter((item = {}) => item.role === "assistant").length,
        toolCount: messages.filter((item = {}) => item.role === "tool").length,
        messages: messagesToPersist.map(projectPersistedMessage),
      });
    };
    const next = persistenceTail.then(persist, persist);
    persistenceTail = next.then(
      () => undefined,
      () => undefined,
    );
    return next;
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
    try {
      return await operation();
    } finally {
      batchDepth -= 1;
      if (batchDepth === 0 && persistenceRequested) {
        persistenceRequested = false;
        await enqueuePersistence();
      }
    }
  };
  dispatchRuntime.commitSummaryCheckpoint = (payload = {}) =>
    commitSummaryCheckpoint({
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
}
