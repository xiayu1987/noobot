/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { normalizeTrimmedString } from "./utils.js";
import {
  createAssistantMessageId,
  createUserMessageId,
  createTurnScopeId,
  hasActiveTurnInFlight,
} from "./sendFlowSupport.js";

/** Normalizes the text and attachment payload carried by the send options. */
function normalizeSendContent(options, { input }) {
  const explicitMessageText =
    typeof options?.messageText === "string" ? options.messageText.trim() : "";
  const explicitAttachmentFiles = Array.isArray(options?.attachmentFiles)
    ? options.attachmentFiles
    : null;
  const explicitTransportAttachments = Array.isArray(options?.transportAttachments)
    ? options.transportAttachments
    : null;
  return {
    explicitMessageText,
    explicitAttachmentFiles,
    explicitUserAttachments: Array.isArray(options?.userAttachments)
      ? options.userAttachments
      : null,
    explicitTransportAttachments,
    hasExplicitAttachments: Boolean(
      explicitAttachmentFiles?.length || explicitTransportAttachments?.length,
    ),
    hasTextToSend: Boolean(explicitMessageText || input.value.trim()),
  };
}

/** Normalizes the control flags and requested identities of the send options. */
function normalizeSendControls(options) {
  return {
    continueFromUserStopped: options?.continueFromUserStopped === true,
    composerRequestStarted: options?.composerRequestStarted === true,
    allowDuringResend: options?.allowDuringResend === true,
    reuseExistingUserTurn: options?.reuseExistingUserTurn === true,
    resumeDialogProcessId: normalizeTrimmedString(options?.resumeDialogProcessId),
    resumeTurnScopeId: normalizeTrimmedString(options?.resumeTurnScopeId),
    dialogProcessId: normalizeTrimmedString(options?.dialogProcessId),
    requestedTurnScopeId: normalizeTrimmedString(options?.turnScopeId),
    requestedUserMessageId: normalizeTrimmedString(options?.userMessageId),
    requestedAssistantMessageId: normalizeTrimmedString(options?.assistantMessageId),
  };
}

/** Normalizes the caller supplied send options into explicit request fields. */
function normalizeSendOptions(options, deps) {
  return { ...normalizeSendContent(options, deps), ...normalizeSendControls(options) };
}

/** True when an in-flight turn must block this request. */
function isBlockedByInFlightTurn(normalized, { activeSession, turnRuntimeRegistry }) {
  const currentSessionInFlight = hasActiveTurnInFlight({ activeSession, turnRuntimeRegistry });
  return (
    (currentSessionInFlight &&
      !normalized.composerRequestStarted &&
      !normalized.allowDuringResend &&
      !normalized.continueFromUserStopped) ||
    !activeSession.value
  );
}

/** True when there is nothing to send. */
function hasNothingToSend(normalized, { uploadFiles }) {
  return (
    !normalized.continueFromUserStopped &&
    !normalized.hasTextToSend &&
    uploadFiles.value.length === 0 &&
    !normalized.hasExplicitAttachments
  );
}

/** True when a resend request does not resolve to an existing user message. */
function isUnresolvableUserTurnReuse(normalized, { activeSession }) {
  if (!normalized.reuseExistingUserTurn) return false;
  const existingUserMessage = (activeSession.value?.messages || []).find(
    (message) => normalizeTrimmedString(message?.messageId) === normalized.requestedUserMessageId,
  );
  return !normalized.requestedUserMessageId || !existingUserMessage;
}

/**
 * Resolves a send request: normalizes options, runs every preflight gate and
 * assigns the turn identity. Returns null when the request must not proceed,
 * mirroring the original inline `return false` gates.
 */
export function resolveSendRequest(options, deps) {
  const normalized = normalizeSendOptions(options, deps);
  if (!deps.ensureConnected()) return null;
  if (isBlockedByInFlightTurn(normalized, deps)) return null;
  if (hasNothingToSend(normalized, deps)) return null;
  if (isUnresolvableUserTurnReuse(normalized, deps)) return null;

  const turnScopeId = normalized.requestedTurnScopeId || createTurnScopeId();
  return {
    ...normalized,
    turnScopeId,
    userMessageId: normalized.requestedUserMessageId || createUserMessageId(),
    assistantMessageId: normalized.requestedAssistantMessageId || createAssistantMessageId(),
    sessionId: String(
      deps.activeSession.value?.sessionId || deps.activeSessionId?.value || "",
    ),
  };
}
