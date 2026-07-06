/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import {
  reconcileStaleResendMessages,
  syncSessionMessageSummary,
} from "./resendReconciler";
import { normalizeTrimmedString } from "./utils";
import {
  getMessageRole,
  getMessageTurnScopeId,
} from "../../infra/messageIdentity";
import { SESSION_RUN_EVENT } from "../sessionRunStateMachine";
import {
  logResendDebug,
  summarizeDebugAttachments,
  summarizeDebugMessage,
  summarizeDebugMessages,
} from "../debug/resendDebugLogger";
import { createSessionVersionManager } from "./sessionVersionManager";
import { serializeAttachments } from "./attachmentSerialization";


function normalizeAttachmentMeta(attachment = {}) {
  if (!attachment || typeof attachment !== "object" || Array.isArray(attachment)) return null;
  const out = { ...attachment };
  delete out.raw;
  delete out.file;
  return out;
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

function mergeAttachmentMetas(historyAttachments = [], serializedAttachments = []) {
  return dedupeAttachmentMetas([
    ...(Array.isArray(historyAttachments) ? historyAttachments : []),
    ...(Array.isArray(serializedAttachments) ? serializedAttachments : []),
  ]);
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
  const states = [
    message?.stopState,
    message?.status,
    message?.state,
    message?.channelState?.state,
    message?.channel_state?.state,
  ].map(normalizeState);
  return states.some((state) => ["stopped", "cancelled", "aborted"].includes(state));
}

function findReplacementUserMessage({ session, turnScopeId }) {
  const messages = Array.isArray(session?.messages) ? session.messages : [];
  const expectedTurnScopeId = normalizeTrimmedString(turnScopeId);
  if (!expectedTurnScopeId) return null;
  return [...messages].reverse().find((message) => {
    if (normalizeMessageRole(message) !== "user") return false;
    return getMessageTurnScopeId(message) === expectedTurnScopeId;
  }) || null;
}

function buildReplacementUserMessageFromDetail(sessionDetail = null, turnScopeId = "", content = "") {
  const expectedTurnScopeId = normalizeTrimmedString(turnScopeId);
  if (!expectedTurnScopeId) return null;
  const sessionDocs = Array.isArray(sessionDetail?.sessions) ? sessionDetail.sessions : [];
  for (const sessionDoc of sessionDocs) {
    const messages = Array.isArray(sessionDoc?.messages) ? sessionDoc.messages : [];
    const userMessage = messages.find((message) => {
      if (normalizeMessageRole(message) !== "user") return false;
      return getMessageTurnScopeId(message) === expectedTurnScopeId;
    });
    if (!userMessage) continue;
    return {
      ...userMessage,
      content,
      ...("text" in userMessage ? { text: content } : {}),
      ...("message" in userMessage ? { message: content } : {}),
      turnScopeId: expectedTurnScopeId,
      pending: false,
    };
  }
  return null;
}

function appendReplacementUserMessage(session, sessionDetail, turnScopeId = "", content = "") {
  if (!session || !Array.isArray(session.messages)) return null;
  const existing = findReplacementUserMessage({ session, turnScopeId });
  if (existing) return existing;
  const replacementUser = buildReplacementUserMessageFromDetail(sessionDetail, turnScopeId, content);
  if (!replacementUser) return null;
  delete replacementUser.stopState;
  delete replacementUser.statusLabel;
  session.messages.push(replacementUser);
  syncSessionMessageSummary(session);
  logResendDebug("resend.replacementUser.insert", {
    turnScopeId,
    replacementUser: summarizeDebugMessage(replacementUser),
    messages: summarizeDebugMessages(session.messages),
  });
  return replacementUser;
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
import { nowMs } from "../../infra/timeFields";

function createTurnScopeId() {
  const randomUuid = globalThis?.crypto?.randomUUID?.();
  if (randomUuid) return `client-turn:${randomUuid}`;
  return `client-turn:${nowMs().toString(36)}:${Math.random().toString(36).slice(2, 10)}`;
}

/**
 * Frontend resend transaction for backend replace-turn.
 *
 * turnScopeId is the frontend-owned request identity. Each resend creates a
 * fresh turnScopeId and only accepts backend replacement data for that scope.
 */
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
    const keptAttachments = Array.isArray(options?.attachments)
      ? dedupeAttachmentMetas(options.attachments)
      : dedupeAttachmentMetas(userTargetMessage?.attachments || []);
    const attachmentFiles = Array.isArray(options?.attachmentFiles) ? options.attachmentFiles : [];
    const serializedNewAttachments = await serializeAttachments?.(attachmentFiles) || [];
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
          idempotencyKey: attempt > 1 ? `${operation?.opId || "resend"}:retry-version` : operation?.opId || "",
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
        if (Array.isArray(activeSession?.value?.messages)) {
          activeSession.value.messages = [...activeSession.value.messages];
        }
        logResendDebug("resend.detail.apply.after", {
          sessionId,
          turnScopeId: resendTurnScopeId,
          messages: summarizeDebugMessages(activeSession?.value?.messages),
        });
      }
      if (operation) applyResendReconcile(messageOperationStore?.getOperation(operation.opId) || operation, { finalOnly: true });
      const replacementUserMessage = findReplacementUserMessage({
        session: activeSession?.value,
        turnScopeId: resendTurnScopeId,
      }) || appendReplacementUserMessage(activeSession?.value, sessionDetail, resendTurnScopeId, text);
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
      replacementUserMessage.content = text;
      replacementUserMessage.attachments = [...finalAttachments];
      if ("text" in replacementUserMessage) replacementUserMessage.text = text;
      if ("message" in replacementUserMessage) replacementUserMessage.message = text;
      delete replacementUserMessage.stopState;
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
      // replace-turn usually only mutates the stored user turn. It must not be
      // treated as a completed resend just because an old assistant snapshot is
      // still present in the preserved frontend message list. Only an explicit
      // backend protocol flag can prove that generation already completed.
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
        finalAttachments: summarizeDebugAttachments(finalAttachments),
        messages: summarizeDebugMessages(activeSession?.value?.messages),
      });
      const sent = await send?.({
        messageText: text,
        reuseExistingUserTurn: true,
        turnScopeId: resendTurnScopeId,
        allowDuringResend: true,
        attachmentFiles: [],
        userAttachments: finalAttachments,
        serializedAttachments: finalAttachments,
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
