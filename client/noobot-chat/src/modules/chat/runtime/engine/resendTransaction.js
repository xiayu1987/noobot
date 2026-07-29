/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import {
  reconcileStaleResendMessages,
  syncSessionMessageSummary,
} from "./resendReconciler.js";
import { normalizeTrimmedString } from "./utils.js";
import {
  getMessageRole,
  getMessageTurnScopeId,
} from "../../model/messageIdentity.js";
import { getMessageRuntimeChannelState, SESSION_RUN_EVENT } from "../sessionRunStateMachine.js";
import { confirmTurnRuntimeDeletion } from "../run-state-machine/turnRuntimeRegistry.js";
import {
  logResendDebug,
  summarizeDebugAttachments,
  summarizeDebugMessage,
  summarizeDebugMessages,
} from "../../../debug/loggers/resendDebugLogger.js";
import { createSessionVersionManager } from "./sessionVersionManager.js";
import { serializeAttachments } from "./attachmentSerialization.js";
import { mergeAttachments } from "../../model/dialogProcessChain.js";
import { nowMs } from "../../model/timeFields.js";


function normalizeAttachmentMeta(attachment = {}) {
  if (!attachment || typeof attachment !== "object" || Array.isArray(attachment)) return null;
  const out = { ...attachment };
  delete out.raw;
  delete out.file;
  return out;
}

function toPendingDisplayAttachment(attachment = {}) {
  const meta = normalizeAttachmentMeta(attachment);
  if (!meta) return null;
  delete meta.contentBase64;
  return meta;
}

function dedupeAttachmentMetas(attachments = []) {
  const seen = new Set();
  const out = [];
  for (const attachment of Array.isArray(attachments) ? attachments : []) {
    const meta = normalizeAttachmentMeta(attachment);
    if (!meta) continue;
    const key = String(meta.attachmentId || meta.id || "").trim() || [
      String(meta.path || "").trim(),
      String(meta.relativePath || "").trim(),
      String(meta.name || meta.filename || meta.fileName || "").trim(),
      String(meta.size || 0),
      String(meta.mimeType || meta.type || "").trim(),
    ].join("|");
    if (key && seen.has(key)) continue;
    if (key) seen.add(key);
    out.push(meta);
  }
  return out;
}

function attachmentIdentityKey(attachment = {}) {
  return String(attachment?.attachmentId || attachment?.id || "").trim() || [
    String(attachment?.path || "").trim(),
    String(attachment?.relativePath || "").trim(),
    String(attachment?.name || attachment?.filename || attachment?.fileName || "").trim(),
    String(attachment?.size || 0),
    String(attachment?.mimeType || attachment?.type || "").trim(),
  ].join("|");
}

function mergeAttachmentMetas(historyAttachments = [], transportAttachments = []) {
  return mergeAttachments(
    dedupeAttachmentMetas(historyAttachments),
    dedupeAttachmentMetas(transportAttachments),
  );
}

function resolveSessionId(activeSession, activeSessionId) {
  return normalizeTrimmedString(
    activeSession?.value?.backendSessionId || activeSession?.value?.sessionId || activeSessionId?.value,
  );
}

function createSessionSnapshot(session, inputValue) {
  return {
    messages: Array.isArray(session?.messages) ? [...session.messages] : null,
    messageCount: session?.messageCount,
    lastMessage: session?.lastMessage,
    updatedAt: session?.updatedAt,
    inputValue,
  };
}

function restoreSessionSnapshot(session, snapshot) {
  if (!session || !snapshot?.messages) return false;
  session.messages = snapshot.messages;
  session.messageCount = snapshot.messageCount;
  session.lastMessage = snapshot.lastMessage;
  session.updatedAt = snapshot.updatedAt;
  return true;
}

function normalizeSessionDetailSnapshot(payload = {}, fallbackSessionId = "") {
  const source = payload && typeof payload === "object" && !Array.isArray(payload) ? payload : {};
  if (Array.isArray(source.sessions) && normalizeTrimmedString(source.sessionId || fallbackSessionId)) {
    return {
      ...source,
      sessionId: normalizeTrimmedString(source.sessionId || fallbackSessionId),
    };
  }
  const session = source.session && typeof source.session === "object" && !Array.isArray(source.session)
    ? source.session
    : Array.isArray(source.messages)
      ? source
      : null;
  if (!session) return null;
  const sessionId = normalizeTrimmedString(session.sessionId || source.sessionId || fallbackSessionId);
  if (!sessionId) return null;
  return {
    ...source,
    sessionId,
    sessions: [{ ...session, sessionId: normalizeTrimmedString(session.sessionId || sessionId) }],
  };
}

function operationSeed({ sessionId, userTargetMessage, originalCascadeStartIndex, removedMessagesBeforeResend }) {
  return {
    type: "resend",
    sessionId,
    status: "pending",
    anchorMessage: userTargetMessage,
    originalStartIndex: originalCascadeStartIndex,
    removedMessages: removedMessagesBeforeResend,
  };
}

function normalizeMessageRole(message = {}) {
  return String(getMessageRole(message) || message?.type || "").trim().toLowerCase();
}

function getMessageText(message = {}) {
  return String(message?.content || message?.text || message?.message || "");
}

function normalizeState(value = "") {
  return String(value || "").trim().toLowerCase();
}

function isStoppedAssistantSnapshot(message = {}) {
  if (normalizeMessageRole(message) !== "assistant") return false;
  return normalizeState(getMessageRuntimeChannelState(message)?.state) === "user_stopped";
}

function findReplacementUserMessageById({ session, messageId }) {
  const messages = Array.isArray(session?.messages) ? session.messages : [];
  const expectedMessageId = normalizeTrimmedString(messageId);
  if (!expectedMessageId) return null;
  return messages.find((message) => (
    normalizeTrimmedString(message?.messageId || message?.id) === expectedMessageId
  )) || null;
}

function resolveReplacementUserMessage(payload = {}) {
  const candidate = payload?.newTurn?.message || payload?.newTurn;
  if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) return null;
  const messageId = normalizeTrimmedString(candidate?.messageId || candidate?.id);
  if (!messageId || normalizeMessageRole(candidate) !== "user") return null;
  return { ...candidate, id: messageId, messageId };
}

function upsertReplacementUserMessage(session, replacementUser = null) {
  if (!session || !Array.isArray(session.messages)) return null;
  const messageId = normalizeTrimmedString(replacementUser?.messageId || replacementUser?.id);
  if (!messageId) return null;
  const existing = findReplacementUserMessageById({ session, messageId });
  if (existing) return existing;
  const inserted = { ...replacementUser, id: messageId, messageId };
  delete inserted.statusLabel;
  session.messages.push(inserted);
  syncSessionMessageSummary(session);
  logResendDebug("resend.replacementUser.insert", {
    turnScopeId: getMessageTurnScopeId(inserted),
    replacementUser: summarizeDebugMessage(inserted),
    messages: summarizeDebugMessages(session.messages),
  });
  return inserted;
}

function pruneLocalMessagesFromIndex(session, startIndex = -1) {
  if (!session || startIndex < 0) return false;
  if (Array.isArray(session.messages)) {
    session.messages = session.messages.slice(0, startIndex);
  }
  syncSessionMessageSummary(session);
  return true;
}

function pruneReplacedTurnMessages(session, { replacement = {}, fallbackTurnScopeId = "", keepTurnScopeId = "" } = {}) {
  if (!session) return false;
  const replacedScopes = new Set(
    (Array.isArray(replacement?.replacedTurnScopeIds) ? replacement.replacedTurnScopeIds : [])
      .map(normalizeTrimmedString)
      .filter(Boolean),
  );
  const fallbackScope = normalizeTrimmedString(fallbackTurnScopeId);
  const keepScope = normalizeTrimmedString(keepTurnScopeId);
  if (fallbackScope && fallbackScope !== keepScope) replacedScopes.add(fallbackScope);
  if (!replacedScopes.size) return false;
  const prune = (messages) => Array.isArray(messages)
    ? messages.filter((message) => {
      const scope = getMessageTurnScopeId(message);
      return !scope || scope === keepScope || !replacedScopes.has(scope);
    })
    : messages;
  const nextMessages = prune(session.messages);
  const changed = nextMessages !== session.messages;
  if (Array.isArray(nextMessages)) session.messages = nextMessages;
  if (changed) syncSessionMessageSummary(session);
  return changed;
}

function pruneStoppedAssistantSnapshotsForTurn(session, turnScopeId = "") {
  if (!session) return false;
  const keepScope = normalizeTrimmedString(turnScopeId);
  if (!keepScope) return false;
  const prune = (messages) => Array.isArray(messages)
    ? messages.filter((message) => {
      if (getMessageTurnScopeId(message) !== keepScope) return true;
      return !isStoppedAssistantSnapshot(message);
    })
    : messages;
  const nextMessages = prune(session.messages);
  const changed = nextMessages !== session.messages;
  if (Array.isArray(nextMessages)) session.messages = nextMessages;
  if (changed) syncSessionMessageSummary(session);
  return changed;
}

function resolveTurnScopeReplacement(payload = {}) {
  return payload?.turnScopeReplacement && typeof payload.turnScopeReplacement === "object" && !Array.isArray(payload.turnScopeReplacement)
    ? payload.turnScopeReplacement
    : null;
}

function collectReplacedTurnScopeIds(payload = {}, fallbackTurnScopeId = "", keepTurnScopeId = "") {
  const replacement = resolveTurnScopeReplacement(payload);
  const keepScope = normalizeTrimmedString(keepTurnScopeId);
  return [...new Set([
    ...(Array.isArray(replacement?.replacedTurnScopeIds) ? replacement.replacedTurnScopeIds : []),
    fallbackTurnScopeId,
  ].map(normalizeTrimmedString).filter((scope) => scope && scope !== keepScope))];
}

function createTurnScopeId() {
  const randomUuid = globalThis?.crypto?.randomUUID?.();
  if (randomUuid) return `client-turn:${randomUuid}`;
  return `client-turn:${nowMs().toString(36)}:${Math.random().toString(36).slice(2, 10)}`;
}

export function createResendMessageTransaction({
  activeSession,
  activeSessionId,
  applyRunStateEvent,
  applySessionDetail,
  authFetch,
  buildMonotonicMessageAnchor,
  clearPendingInteraction,
  findMessageCascadeStartIndex,
  input,
  messageOperationStore,
  prepareMonotonicMessageAction,
  replaceSessionTurnApi,
  fetchSessionDetail,
  resolveMonotonicUserTarget,
  send,
  userId,
  turnRuntimeRegistry,
} = {}) {
  function applyResendReconcile(operation, options = {}) {
    const session = activeSession?.value;
    const result = reconcileStaleResendMessages(session, operation, options);
    if (result.changed) {
      syncSessionMessageSummary(session);
      clearPendingInteraction?.();
    }
    return result.changed;
  }

  function pruneStaleMessagesAfterResend(anchorMessage = {}, originalStartIndex = -1, removedMessages = [], options = {}) {
    return applyResendReconcile({
      anchorMessage,
      originalStartIndex,
      removedMessages,
    }, options);
  }

  function finalizePendingResendOperation({ finalOnly = true } = {}) {
    const sessionId = resolveSessionId(activeSession, activeSessionId);
    const operation = messageOperationStore?.getActiveOperation(sessionId, "resend")
      || messageOperationStore?.getLatestOperation("resend");
    if (!operation) return false;
    messageOperationStore?.updateOperation(operation.opId, { status: "reconciling" });
    const updatedOperation = messageOperationStore?.getOperation(operation.opId) || operation;
    applyResendReconcile(updatedOperation, { finalOnly });
    messageOperationStore?.completeOperation(updatedOperation.opId);
    return true;
  }

  const sessionVersionManager = createSessionVersionManager({
    activeSession,
    fetchSessionDetail,
    applySessionDetail,
    log: (event, payload) => logResendDebug(`resend.${event}`, {
      ...payload,
      messages: summarizeDebugMessages(activeSession?.value?.messages),
    }),
  });

  async function requestReplaceTurn({ sessionId, originalSession, anchor, text, resendTurnScopeId, idempotencyKey, attempt, expectedVersion, attachments }) {
    logResendDebug("resend.replaceTurn.request", {
      sessionId,
      turnScopeId: resendTurnScopeId,
      anchor,
      expectedVersion,
      attempt,
      idempotencyKey,
      attachments: summarizeDebugAttachments(attachments),
      messages: summarizeDebugMessages(activeSession?.value?.messages),
    });
    const result = await replaceSessionTurnApi({
      userId: userId?.value || userId,
      sessionId,
      parentSessionId: normalizeTrimmedString(originalSession?.parentSessionId),
      anchor,
      newContent: text,
      turnScopeId: resendTurnScopeId,
      expectedVersion,
      idempotencyKey,
      attachments,
    }, { fetcher: authFetch });
    const payload = typeof result?.json === "function" ? await result.json() : result;
    return { result, payload };
  }

  async function resendMonotonicMessage(targetMessage = {}, editedContent = "", options = {}) {
    const text = String(editedContent || "").trim();
    if (!text) return false;

    const prepared = await prepareMonotonicMessageAction?.(options);
    if (prepared === false) return false;
    const userTargetMessage = resolveMonotonicUserTarget?.(targetMessage);
    if (!userTargetMessage) return false;

    const originalSession = activeSession?.value;
    const removedAttachmentKeys = new Set(
      (Array.isArray(options?.removedAttachmentKeys) ? options.removedAttachmentKeys : [])
        .map((key) => String(key || "").trim())
        .filter(Boolean),
    );
    const authoritativeAttachments = dedupeAttachmentMetas(userTargetMessage?.attachments || [])
      .filter((attachment) => !removedAttachmentKeys.has(attachmentIdentityKey(attachment)));
    const keptAttachments = dedupeAttachmentMetas([
      ...authoritativeAttachments,
      ...(Array.isArray(options?.attachments) ? options.attachments : []),
    ]);
    const attachmentFiles = Array.isArray(options?.attachmentFiles) ? options.attachmentFiles : [];
    const serializedNewAttachments = await serializeAttachments?.(attachmentFiles) || [];
    const pendingDisplayAttachments = serializedNewAttachments
      .map((attachment) => toPendingDisplayAttachment(attachment))
      .filter(Boolean);
    const finalAttachments = mergeAttachmentMetas(keptAttachments, serializedNewAttachments);
    const snapshot = createSessionSnapshot(originalSession, input?.value);
    const originalCascadeStartIndex = findMessageCascadeStartIndex?.(userTargetMessage) ?? -1;
    const removedMessagesBeforeResend = Array.isArray(originalSession?.messages) && originalCascadeStartIndex >= 0
      ? originalSession.messages.slice(originalCascadeStartIndex)
      : [];
    const sessionId = resolveSessionId(activeSession, activeSessionId);
    const resendTurnScopeId = normalizeTrimmedString(options?.turnScopeId) || createTurnScopeId();
    logResendDebug("resend.attachments.resolved", {
      sessionId,
      oldTurnScopeId: getMessageTurnScopeId(userTargetMessage),
      turnScopeId: resendTurnScopeId,
      optionsAttachments: summarizeDebugAttachments(options?.attachments),
      targetAttachments: summarizeDebugAttachments(userTargetMessage?.attachments),
      keptAttachments: summarizeDebugAttachments(keptAttachments),
      attachmentFiles: { kind: Array.isArray(options?.attachmentFiles) ? "array" : "undefined", count: attachmentFiles.length },
      serializedNewAttachments: summarizeDebugAttachments(serializedNewAttachments),
      finalAttachments: summarizeDebugAttachments(finalAttachments),
    });
    logResendDebug("resend.begin", {
      sessionId,
      oldTurnScopeId: getMessageTurnScopeId(userTargetMessage),
      turnScopeId: resendTurnScopeId,
      target: summarizeDebugMessage(userTargetMessage),
      messages: summarizeDebugMessages(originalSession?.messages),
    });

    if (typeof replaceSessionTurnApi !== "function") return false;
    const anchor = buildMonotonicMessageAnchor?.(userTargetMessage) || {};
    if (!normalizeTrimmedString(anchor.turnScopeId)) return false;

    const operation = messageOperationStore?.registerOperation(operationSeed({
      sessionId,
      userTargetMessage,
      originalCascadeStartIndex,
      removedMessagesBeforeResend,
    }));
    const oldTurnScopeId = getMessageTurnScopeId(userTargetMessage);
    applyRunStateEvent?.({
      type: SESSION_RUN_EVENT.LOCAL_RESEND_STARTED,
      sessionId,
      turnScopeId: resendTurnScopeId,
      source: "resend_transaction",
    });
    applyRunStateEvent?.({
      type: SESSION_RUN_EVENT.LOCAL_RESEND_REPLACING_TURN,
      sessionId,
      turnScopeId: resendTurnScopeId,
      source: "resend_transaction",
    });
    try {
      const mutationResult = await sessionVersionManager.runVersionedMutation({
        refreshOptions: {
          sessionId,
          detailOptions: { source: "resendVersionConflict" },
          logContext: { turnScopeId: resendTurnScopeId },
        },
        mutate: ({ expectedVersion, attempt }) => requestReplaceTurn({
          sessionId,
          originalSession,
          anchor,
          text,
          resendTurnScopeId,
          expectedVersion,
          idempotencyKey: operation?.opId || "",
          attempt,
          attachments: finalAttachments,
        }),
      });
      let { result, payload, expectedVersion } = mutationResult || {};
      logResendDebug("resend.replaceTurn.result", {
        sessionId,
        turnScopeId: resendTurnScopeId,
        ok: result?.ok !== false && payload?.ok !== false,
        generation: payload?.generation,
        generated: payload?.generated,
        replacement: resolveTurnScopeReplacement(payload),
      });
      if (result?.ok === false || payload?.ok === false) {
        logResendDebug("resend.replaceTurn.failed", {
          sessionId,
          turnScopeId: resendTurnScopeId,
          httpOk: result?.ok,
          status: result?.status,
          statusText: result?.statusText,
          anchor,
          expectedVersion,
          idempotencyKey: operation?.opId || "",
          payload,
          target: summarizeDebugMessage(userTargetMessage),
          messages: summarizeDebugMessages(activeSession?.value?.messages),
        });
        if (operation) messageOperationStore?.completeOperation(operation.opId);
        applyRunStateEvent?.({
          type: SESSION_RUN_EVENT.LOCAL_RESEND_FAILED,
          sessionId,
          turnScopeId: resendTurnScopeId,
          source: "resend_transaction",
        });
        restoreSessionSnapshot(activeSession?.value, snapshot);
        input.value = snapshot.inputValue;
        return false;
      }
      const replacedTurnScopeIds = collectReplacedTurnScopeIds(
        payload,
        oldTurnScopeId,
        resendTurnScopeId,
      );
      const replacementDeletion = confirmTurnRuntimeDeletion(
        turnRuntimeRegistry?.value || turnRuntimeRegistry,
        replacedTurnScopeIds,
        { sessionId },
      );
      logResendDebug("resend.replacedTurns.tombstoned", {
        sessionId,
        turnScopeId: resendTurnScopeId,
        replacedTurnScopeIds,
        confirmedTurnScopeIds: replacementDeletion.confirmedTurnScopeIds,
        removedTurnScopeIds: replacementDeletion.removedTurnScopeIds,
      });
      const replacementPatch = {
        status: "reconciling",
        ...(resolveTurnScopeReplacement(payload) ? { turnScopeReplacement: resolveTurnScopeReplacement(payload) } : {}),
      };
      if (operation) messageOperationStore?.updateOperation(operation.opId, replacementPatch);
      const sessionDetail = normalizeSessionDetailSnapshot(payload, sessionId);
      if (sessionDetail) {
        logResendDebug("resend.detail.apply.before", {
          sessionId,
          turnScopeId: resendTurnScopeId,
          preserveCurrentMessages: true,
          messages: summarizeDebugMessages(activeSession?.value?.messages),
        });
        applySessionDetail?.(sessionDetail, { preserveCurrentMessages: true });
        logResendDebug("resend.detail.apply.after", {
          sessionId,
          turnScopeId: resendTurnScopeId,
          messages: summarizeDebugMessages(activeSession?.value?.messages),
        });
      }
      if (operation) applyResendReconcile(messageOperationStore?.getOperation(operation.opId) || operation, { finalOnly: true });
      const replacementUserMessage = upsertReplacementUserMessage(
        activeSession?.value,
        resolveReplacementUserMessage(payload),
      );
      if (!replacementUserMessage) {
        if (operation) messageOperationStore?.completeOperation(operation.opId);
        applyRunStateEvent?.({
          type: SESSION_RUN_EVENT.LOCAL_RESEND_FAILED,
          sessionId,
          turnScopeId: resendTurnScopeId,
          source: "resend_transaction",
        });
        restoreSessionSnapshot(activeSession?.value, snapshot);
        input.value = snapshot.inputValue;
        return false;
      }
      const persistedAttachments = dedupeAttachmentMetas(replacementUserMessage.attachments || []);
      const attachmentsForDisplay = mergeAttachmentMetas(
        persistedAttachments,
        pendingDisplayAttachments,
      );
      replacementUserMessage.content = text;
      replacementUserMessage.attachments = mergeAttachmentMetas(
        attachmentsForDisplay,
        persistedAttachments,
      );
      if ("text" in replacementUserMessage) replacementUserMessage.text = text;
      if ("message" in replacementUserMessage) replacementUserMessage.message = text;
      delete replacementUserMessage.statusLabel;
      pruneReplacedTurnMessages(activeSession?.value, {
        replacement: resolveTurnScopeReplacement(payload),
        fallbackTurnScopeId: getMessageTurnScopeId(userTargetMessage),
        keepTurnScopeId: resendTurnScopeId,
      });
      const prunedStopped = pruneStoppedAssistantSnapshotsForTurn(activeSession?.value, resendTurnScopeId);
      logResendDebug("resend.prune.after", {
        sessionId,
        turnScopeId: resendTurnScopeId,
        replacementUser: summarizeDebugMessage(replacementUserMessage),
        prunedStopped,
        messages: summarizeDebugMessages(activeSession?.value?.messages),
      });
      if (payload?.generation === "completed" || payload?.generated === true) {
        logResendDebug("resend.completedWithoutStream", {
          sessionId,
          turnScopeId: resendTurnScopeId,
          generation: payload?.generation,
          generated: payload?.generated,
        });
        if (operation) messageOperationStore?.completeOperation(operation.opId);
        applyRunStateEvent?.({
          type: SESSION_RUN_EVENT.LOCAL_RESEND_COMPLETED,
          sessionId,
          turnScopeId: resendTurnScopeId,
          source: "resend_transaction",
        });
        input.value = "";
        return true;
      }
      if (operation) messageOperationStore?.updateOperation(operation.opId, { status: "sending" });
      applyRunStateEvent?.({
        type: SESSION_RUN_EVENT.LOCAL_RESEND_STREAMING,
        sessionId,
        turnScopeId: resendTurnScopeId,
        source: "resend_transaction",
      });
      input.value = text;
      logResendDebug("resend.send.before", {
        sessionId,
        turnScopeId: resendTurnScopeId,
        finalAttachments: summarizeDebugAttachments(replacementUserMessage.attachments),
        messages: summarizeDebugMessages(activeSession?.value?.messages),
      });
      const sent = await send?.({
        messageText: text,
        reuseExistingUserTurn: true,
        userMessageId: normalizeTrimmedString(replacementUserMessage?.messageId || replacementUserMessage?.id),
        turnScopeId: resendTurnScopeId,
        allowDuringResend: true,
        attachmentFiles: [],
        userAttachments: replacementUserMessage.attachments,
        transportAttachments: replacementUserMessage.attachments,
      });
      logResendDebug("resend.send.after", {
        sessionId,
        turnScopeId: resendTurnScopeId,
        sent,
        messages: summarizeDebugMessages(activeSession?.value?.messages),
      });
      if (!sent) {
        if (operation) messageOperationStore?.completeOperation(operation.opId);
        applyRunStateEvent?.({
          type: SESSION_RUN_EVENT.LOCAL_RESEND_FAILED,
          sessionId,
          turnScopeId: resendTurnScopeId,
          source: "resend_transaction",
        });
        restoreSessionSnapshot(activeSession?.value, snapshot);
        input.value = snapshot.inputValue;
        return false;
      }
      if (operation && messageOperationStore?.getOperation(operation.opId)) {
        messageOperationStore.completeOperation(operation.opId);
      }
      return true;
    } catch {
      if (operation) messageOperationStore?.completeOperation(operation.opId);
      applyRunStateEvent?.({
        type: SESSION_RUN_EVENT.LOCAL_RESEND_FAILED,
        sessionId,
        turnScopeId: resendTurnScopeId,
        source: "resend_transaction",
      });
      restoreSessionSnapshot(activeSession?.value, snapshot);
      input.value = snapshot.inputValue;
      return false;
    }
  }

  return {
    finalizePendingResendOperation,
    pruneStaleMessagesAfterResend,
    resendMonotonicMessage,
  };
}
