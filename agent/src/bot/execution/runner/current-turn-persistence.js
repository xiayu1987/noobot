/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { emitEvent } from "../../../events/index.js";

function checkpointKey(message = {}, index = 0) {
  const messageUid = String(message?.messageUid || "").trim();
  if (messageUid) return `uid:${messageUid}`;
  const messageId = String(message?.messageId || message?.id || "").trim();
  const dialogProcessId = String(message?.dialogProcessId || "").trim();
  const turnScopeId = String(message?.turnScopeId || "").trim();
  if (messageId) return `message:${dialogProcessId}:${turnScopeId}:${messageId}`;
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
      .map((item = {}) => [String(item.messageUid || "").trim(), item])
      .filter(([messageUid]) => messageUid),
  );
  return activityMessages.map((item = {}) => {
    const messageUid = String(item.messageUid || "").trim();
    const expectedEventIds = item.activityTimeline
      .map((activity = {}) => String(activity.eventId || "").trim())
      .filter(Boolean);
    const durable = durableByUid.get(messageUid);
    const durableEventIds = (
      Array.isArray(durable?.activityTimeline) ? durable.activityTimeline : []
    )
      .map((activity = {}) => String(activity.eventId || "").trim())
      .filter(Boolean);
    const missingEventIds = expectedEventIds.filter(
      (eventId) => !durableEventIds.includes(eventId),
    );
    return { messageUid, expectedEventIds, durableEventIds, missingEventIds };
  });
}

function projectPersistedMessage(message = {}) {
  return {
    messageUid: String(message.messageUid || "").trim(),
    messageId: String(message.messageId || message.id || "").trim(),
    presentationMessageId: String(message.presentationMessageId || "").trim(),
    role: String(message.role || "").trim(),
    type: String(message.type || "").trim(),
    chatPresentation: message.chatPresentation === true,
    contentLength: typeof message.content === "string" ? message.content.length : 0,
    activityTimelineCount: Array.isArray(message.activityTimeline)
      ? message.activityTimeline.length
      : 0,
    toolTimelineCount: Array.isArray(message.toolTimeline) ? message.toolTimeline.length : 0,
    toolCallIds: Array.isArray(message.toolTimeline)
      ? message.toolTimeline
          .map((tool = {}) => String(tool.toolCallId || "").trim())
          .filter(Boolean)
      : [],
    activityTimeline: Array.isArray(message.activityTimeline)
      ? message.activityTimeline.slice(0, 64).map((activity = {}) => ({
          eventId: String(activity.eventId || "").trim(),
          activityKind: String(activity.activityKind || activity.type || "").trim(),
          sequence: Number(activity.sequence || 0),
          sequenceDomain: String(activity.sequenceDomain || "").trim(),
          sequenceScopeId: String(activity.sequenceScopeId || "").trim(),
          authority: String(activity.authority || "").trim(),
        }))
      : [],
  };
}

export function bindCurrentTurnPersistence({
  dispatchRuntime,
  appendAgentMessages,
  getSessionTurns,
  commitSummaryCheckpoint,
  userId,
  sessionId,
  parentSessionId,
  dialogProcessId,
  parentDialogProcessId,
  turnScopeId,
  eventListener,
  persistenceContext,
}) {
  let persistenceTail = Promise.resolve();
  let batchDepth = 0;
  let persistenceRequested = false;
  const persistedFingerprints = new Map();
  dispatchRuntime.timelineCheckpointPersistedMessageUids = [];

  const enqueuePersistence = () => {
    const persist = async () => {
      const messages = dispatchRuntime.currentTurnMessages?.toArray?.();
      if (!Array.isArray(messages) || !messages.length) return;
      const checkpointEntries = buildCheckpointEntries(messages);
      const changedEntries = checkpointEntries.filter(
        ({ key, fingerprint }) =>
          fingerprint === null || persistedFingerprints.get(key) !== fingerprint,
      );
      const messagesToPersist = changedEntries.map(({ message }) => message);
      if (!messagesToPersist.length) {
        dispatchRuntime.timelineCheckpointPersistedMessageUids = messages
          .map((item = {}) => String(item.messageUid || "").trim())
          .filter(Boolean);
        return;
      }
      const persistedMessages = await appendAgentMessages?.({
        userId,
        sessionId,
        parentSessionId,
        messages: messagesToPersist,
        dialogProcessId,
        parentDialogProcessId,
        turnScopeId,
        eventListener,
        persistenceContext,
      });
      const activityMessages = messagesToPersist.filter(
        (item = {}) =>
          String(item.messageUid || "").trim() &&
          Array.isArray(item.activityTimeline) &&
          item.activityTimeline.length > 0,
      );
      let durableActivityMessages = [];
      if (
        activityMessages.length > 0 &&
        ((Array.isArray(persistedMessages) && persistedMessages.length > 0) ||
          typeof getSessionTurns === "function")
      ) {
        const durableMessages =
          Array.isArray(persistedMessages) && persistedMessages.length > 0
            ? persistedMessages
            : await getSessionTurns({
                userId,
                sessionId,
                parentSessionId,
                persistenceContext,
              });
        durableActivityMessages = projectActivityDurability(activityMessages, durableMessages);
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
        .map((item = {}) => String(item.messageUid || "").trim())
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
    commitSummaryCheckpoint?.({
      runtime: dispatchRuntime,
      userId,
      sessionId,
      parentSessionId,
      dialogProcessId,
      parentDialogProcessId,
      turnScopeId,
      eventListener,
      persistenceContext,
      ...payload,
    });
}
