/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { normalizeTrimmedString } from "./utils.js";
import { getMessageTurnScopeId } from "../../model/messageIdentity.js";
import { SESSION_RUN_EVENT } from "../sessionRunStateMachine.js";
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
import {
  logStateMachineDebug,
  summarizeStateMachineMessage,
} from "../../../debug/loggers/stateMachineLogger.js";
import { SESSION_DETAIL_APPLY_MODE } from "./messageStateGuards.js";
import { assertTurnReplacementMaterialization } from "@noobot/shared/turn-replacement-protocol";


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

function createSessionDetailSnapshot(session = {}) {
  return {
    sessionId: session.sessionId,
    sessions: [session],
  };
}

function operationSeed({ sessionId }) {
  return {
    type: "resend",
    sessionId,
    status: "pending",
  };
}

function ownsMessageOperation(messageOperationStore, operation = null) {
  if (!operation || typeof messageOperationStore?.getActiveOperation !== "function") return true;
  return messageOperationStore.getActiveOperation(operation.sessionId)?.opId === operation.opId;
}

function getMessageText(message = {}) {
  return String(message?.content || message?.text || message?.message || "");
}

function findReplacementUserMessageById({ session, messageId }) {
  const messages = Array.isArray(session?.messages) ? session.messages : [];
  const expectedMessageId = normalizeTrimmedString(messageId);
  if (!expectedMessageId) return null;
  return messages.find((message) => (
    normalizeTrimmedString(message?.messageId) === expectedMessageId
  )) || null;
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
  input,
  messageOperationStore,
  prepareMonotonicMessageAction,
  replaceSessionTurnApi,
  fetchSessionDetail,
  resolveMonotonicUserTarget,
  send,
  userId,
  turnRuntimeRegistry,
  removeWorkflowOwnersForReplacedTurns,
} = {}) {
  function finalizePendingResendOperation() {
    const sessionId = resolveSessionId(activeSession, activeSessionId);
    const operation = messageOperationStore?.getActiveOperation(sessionId, "resend")
      || messageOperationStore?.getLatestOperation("resend");
    if (!operation) return false;
    messageOperationStore?.completeOperation(operation.opId);
    return true;
  }

  const sessionVersionManager = createSessionVersionManager({
    activeSession,
    fetchSessionDetail,
    applySessionDetail,
    log: (event, payload) => logResendDebug(`resend.${event}`, () => ({
      ...payload,
      messages: summarizeDebugMessages(activeSession?.value?.messages),
    })),
  });

  async function requestReplaceTurn({ sessionId, originalSession, anchor, text, resendTurnScopeId, idempotencyKey, attempt, expectedVersion, attachments }) {
    logResendDebug("resend.replaceTurn.request", () => ({
      sessionId,
      turnScopeId: resendTurnScopeId,
      anchor,
      expectedVersion,
      attempt,
      idempotencyKey,
      attachments: summarizeDebugAttachments(attachments),
      messages: summarizeDebugMessages(activeSession?.value?.messages),
    }));
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

    const userTargetMessage = resolveMonotonicUserTarget?.(targetMessage);
    if (!userTargetMessage) return false;
    const originalSession = activeSession?.value;
    const originalInputValue = input?.value;
    const sessionId = resolveSessionId(activeSession, activeSessionId);
    const resendTurnScopeId = normalizeTrimmedString(options?.turnScopeId) || createTurnScopeId();
    const operation = messageOperationStore?.registerOperation(operationSeed({ sessionId }));
    if (!normalizeTrimmedString(operation?.opId)) {
      throw new TypeError("resend command registration failed: missing_command_id");
    }
    try {
      const prepared = await prepareMonotonicMessageAction?.(options);
      if (prepared === false || !ownsMessageOperation(messageOperationStore, operation)) {
        messageOperationStore?.completeOperation(operation.opId);
        return false;
      }
    } catch (error) {
      messageOperationStore?.completeOperation(operation.opId);
      throw error;
    }
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
    let serializedNewAttachments;
    try {
      serializedNewAttachments = await serializeAttachments?.(attachmentFiles) || [];
    } catch (error) {
      messageOperationStore?.completeOperation(operation.opId);
      throw error;
    }
    if (!ownsMessageOperation(messageOperationStore, operation)) return false;
    const pendingDisplayAttachments = serializedNewAttachments
      .map((attachment) => toPendingDisplayAttachment(attachment))
      .filter(Boolean);
    const finalAttachments = mergeAttachmentMetas(keptAttachments, serializedNewAttachments);
    logResendDebug("resend.attachments.resolved", () => ({
      sessionId,
      oldTurnScopeId: getMessageTurnScopeId(userTargetMessage),
      turnScopeId: resendTurnScopeId,
      optionsAttachments: summarizeDebugAttachments(options?.attachments),
      targetAttachments: summarizeDebugAttachments(userTargetMessage?.attachments),
      keptAttachments: summarizeDebugAttachments(keptAttachments),
      attachmentFiles: { kind: Array.isArray(options?.attachmentFiles) ? "array" : "undefined", count: attachmentFiles.length },
      serializedNewAttachments: summarizeDebugAttachments(serializedNewAttachments),
      finalAttachments: summarizeDebugAttachments(finalAttachments),
    }));
    logResendDebug("resend.begin", () => ({
      sessionId,
      oldTurnScopeId: getMessageTurnScopeId(userTargetMessage),
      turnScopeId: resendTurnScopeId,
      target: summarizeDebugMessage(userTargetMessage),
      messages: summarizeDebugMessages(originalSession?.messages),
    }));

    if (typeof replaceSessionTurnApi !== "function") {
      messageOperationStore?.completeOperation(operation.opId);
      return false;
    }
    const anchor = buildMonotonicMessageAnchor?.(userTargetMessage) || {};
    if (!normalizeTrimmedString(anchor.turnScopeId)) {
      messageOperationStore?.completeOperation(operation.opId);
      return false;
    }

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
    let replacementCommitted = false;
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
      logResendDebug("resend.replaceTurn.result", () => ({
        sessionId,
        turnScopeId: resendTurnScopeId,
        ok: result?.ok !== false && payload?.ok !== false,
        generation: payload?.generation,
        generated: payload?.generated,
        replacement: payload?.turnReplacement || null,
      }));
      if (result?.ok === false || payload?.ok === false) {
        logResendDebug("resend.replaceTurn.failed", () => ({
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
        }));
        if (operation) messageOperationStore?.completeOperation(operation.opId);
        applyRunStateEvent?.({
          type: SESSION_RUN_EVENT.LOCAL_RESEND_FAILED,
          sessionId,
          turnScopeId: resendTurnScopeId,
          source: "resend_transaction",
        });
        input.value = originalInputValue;
        return false;
      }
      if (!ownsMessageOperation(messageOperationStore, operation)) return false;
      const materialization = assertTurnReplacementMaterialization({
        commit: payload?.turnReplacement,
        session: payload?.session,
      });
      const turnReplacement = materialization.commit;
      if (turnReplacement.commandId !== operation.opId) {
        throw new TypeError("invalid turn replacement commit: command_id_mismatch");
      }
      if (turnReplacement.replacementTurnScopeId !== resendTurnScopeId) {
        throw new TypeError("invalid turn replacement commit: requested_scope_mismatch");
      }
      if (!turnReplacement.replacedTurnScopeIds.includes(oldTurnScopeId)) {
        throw new TypeError("invalid turn replacement commit: replaced_scope_mismatch");
      }
      replacementCommitted = true;
      const replacedTurnScopeIds = [...turnReplacement.replacedTurnScopeIds];
      const replacementDeletion = confirmTurnRuntimeDeletion(
        turnRuntimeRegistry?.value || turnRuntimeRegistry,
        replacedTurnScopeIds,
        { sessionId },
      );
      const workflowOwnerDeletion = removeWorkflowOwnersForReplacedTurns?.({
        parentSessionId: sessionId,
        replacedTurnScopeIds,
      }) || { removedWorkflowRunIds: [], removedSessionIds: [] };
      logResendDebug("resend.replacedTurns.tombstoned", () => ({
        sessionId,
        turnScopeId: resendTurnScopeId,
        replacedTurnScopeIds,
        confirmedTurnScopeIds: replacementDeletion.confirmedTurnScopeIds,
        removedTurnScopeIds: replacementDeletion.removedTurnScopeIds,
        removedWorkflowRunIds: workflowOwnerDeletion.removedWorkflowRunIds,
        removedSubSessionIds: workflowOwnerDeletion.removedSessionIds,
      }));
      if (operation) messageOperationStore?.updateOperation(operation.opId, {
        status: "materializing",
        turnReplacement,
      });
      const sessionDetail = createSessionDetailSnapshot(materialization.session);
      logResendDebug("resend.detail.apply.before", () => ({
        sessionId,
        turnScopeId: resendTurnScopeId,
        mode: SESSION_DETAIL_APPLY_MODE.DELETE_CONFIRMED,
        messages: summarizeDebugMessages(activeSession?.value?.messages),
      }));
      applySessionDetail?.(sessionDetail, {
        mode: SESSION_DETAIL_APPLY_MODE.DELETE_CONFIRMED,
        deletedTurnScopeIds: replacedTurnScopeIds,
      });
      const replacementUserMessage = findReplacementUserMessageById({
        session: activeSession?.value,
        messageId: turnReplacement.replacementUserMessageId,
      });
      if (!replacementUserMessage) {
        throw new TypeError("invalid turn replacement projection: replacement_user_missing");
      }
      logStateMachineDebug("stateMachine.resend.materializationCommitted", () => ({
        sessionId,
        turnScopeId: resendTurnScopeId,
        committedVersion: turnReplacement.committedVersion,
        replacedTurnScopeIds,
        replacementUser: summarizeStateMachineMessage(replacementUserMessage),
        messages: (activeSession?.value?.messages || []).map(summarizeStateMachineMessage),
      }));
      logResendDebug("resend.detail.apply.after", () => ({
        sessionId,
        turnScopeId: resendTurnScopeId,
        messages: summarizeDebugMessages(activeSession?.value?.messages),
      }));
      const persistedAttachments = dedupeAttachmentMetas(replacementUserMessage.attachments || []);
      const attachmentsForDisplay = mergeAttachmentMetas(
        persistedAttachments,
        pendingDisplayAttachments,
      );
      replacementUserMessage.attachments = mergeAttachmentMetas(
        attachmentsForDisplay,
        persistedAttachments,
      );
      delete replacementUserMessage.statusLabel;
      if (operation) messageOperationStore?.updateOperation(operation.opId, { status: "sending" });
      applyRunStateEvent?.({
        type: SESSION_RUN_EVENT.LOCAL_RESEND_STREAMING,
        sessionId,
        turnScopeId: resendTurnScopeId,
        source: "resend_transaction",
      });
      if (!ownsMessageOperation(messageOperationStore, operation)) return false;
      input.value = text;
      logResendDebug("resend.send.before", () => ({
        sessionId,
        turnScopeId: resendTurnScopeId,
        finalAttachments: summarizeDebugAttachments(replacementUserMessage.attachments),
        messages: summarizeDebugMessages(activeSession?.value?.messages),
      }));
      const sent = await send?.({
        messageText: text,
        reuseExistingUserTurn: true,
        userMessageId: normalizeTrimmedString(replacementUserMessage?.messageId),
        turnScopeId: resendTurnScopeId,
        allowDuringResend: true,
        attachmentFiles: [],
        userAttachments: replacementUserMessage.attachments,
        transportAttachments: replacementUserMessage.attachments,
      });
      logResendDebug("resend.send.after", () => ({
        sessionId,
        turnScopeId: resendTurnScopeId,
        sent,
        messages: summarizeDebugMessages(activeSession?.value?.messages),
      }));
      if (!sent) {
        if (operation) messageOperationStore?.completeOperation(operation.opId);
        applyRunStateEvent?.({
          type: SESSION_RUN_EVENT.LOCAL_RESEND_FAILED,
          sessionId,
          turnScopeId: resendTurnScopeId,
          source: "resend_transaction",
        });
        input.value = text;
        return false;
      }
      if (operation && messageOperationStore?.getOperation(operation.opId)) {
        messageOperationStore.completeOperation(operation.opId);
      }
      return true;
    } catch (error) {
      if (operation) messageOperationStore?.completeOperation(operation.opId);
      logStateMachineDebug("stateMachine.resend.failed", () => ({
        sessionId,
        turnScopeId: resendTurnScopeId,
        replacementCommitted,
        errorType: String(error?.name || "Error"),
        errorMessage: String(error?.message || error || "").slice(0, 240),
        messages: (activeSession?.value?.messages || []).map(summarizeStateMachineMessage),
      }));
      applyRunStateEvent?.({
        type: SESSION_RUN_EVENT.LOCAL_RESEND_FAILED,
        sessionId,
        turnScopeId: resendTurnScopeId,
        source: "resend_transaction",
      });
      input.value = replacementCommitted ? text : originalInputValue;
      return false;
    }
  }

  return {
    finalizePendingResendOperation,
    resendMonotonicMessage,
  };
}
