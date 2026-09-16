/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { normalizeTrimmedString } from "./utils.js";
import { getMessageTurnScopeId } from "../../model/messageIdentity.js";
import {
  logResendDebug,
  summarizeDebugAttachments,
  summarizeDebugMessage,
  summarizeDebugMessages,
} from "../../../debug/loggers/resendDebugLogger.js";
import { serializeAttachments } from "./attachmentSerialization.js";
import {
  dedupeDraftAttachmentMetas,
  resolveKeptAttachments,
  toPendingDisplayAttachment,
} from "./resendAttachments.js";

const ABORTED = Object.freeze({ aborted: true });
const REJECTED = Object.freeze({ rejected: true });

async function resolveResendAttachments({
  operationGuard,
  options,
  originalSession,
  resendTurnScopeId,
  sessionId,
  userTargetMessage,
}) {
  const keptAttachments = resolveKeptAttachments(userTargetMessage, options);
  const attachmentFiles = Array.isArray(options?.attachmentFiles) ? options.attachmentFiles : [];
  const serializedNewAttachments = (await serializeAttachments?.(attachmentFiles)) || [];
  if (!operationGuard.owns()) return ABORTED;
  const pendingDisplayAttachments = serializedNewAttachments
    .map((attachment) => toPendingDisplayAttachment(attachment))
    .filter(Boolean);
  const finalAttachments = [
    ...keptAttachments,
    ...dedupeDraftAttachmentMetas(serializedNewAttachments),
  ];
  logResendDebug("resend.attachments.resolved", () => ({
    sessionId,
    oldTurnScopeId: getMessageTurnScopeId(userTargetMessage),
    turnScopeId: resendTurnScopeId,
    optionsAttachments: summarizeDebugAttachments(options?.attachments),
    targetAttachments: summarizeDebugAttachments(userTargetMessage?.attachments),
    keptAttachments: summarizeDebugAttachments(keptAttachments),
    attachmentFiles: {
      kind: Array.isArray(options?.attachmentFiles) ? "array" : "undefined",
      count: attachmentFiles.length,
    },
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
  return { finalAttachments, pendingDisplayAttachments };
}

export async function prepareResendTransaction({
  buildMonotonicMessageAnchor,
  operationGuard,
  options,
  originalSession,
  prepareMonotonicMessageAction,
  replaceSessionTurnApi,
  resendTurnScopeId,
  sessionId,
  userTargetMessage,
}) {
  const prepared = await prepareMonotonicMessageAction?.(options);
  if (prepared === false || !operationGuard.owns()) return REJECTED;

  const attachmentResolution = await resolveResendAttachments({
    operationGuard,
    options,
    originalSession,
    resendTurnScopeId,
    sessionId,
    userTargetMessage,
  });
  if (attachmentResolution.aborted) return ABORTED;

  if (typeof replaceSessionTurnApi !== "function") return REJECTED;
  const anchor = buildMonotonicMessageAnchor?.(userTargetMessage) || {};
  if (!normalizeTrimmedString(anchor.turnScopeId)) return REJECTED;

  return {
    anchor,
    finalAttachments: attachmentResolution.finalAttachments,
    oldTurnScopeId: getMessageTurnScopeId(userTargetMessage),
    pendingDisplayAttachments: attachmentResolution.pendingDisplayAttachments,
  };
}
