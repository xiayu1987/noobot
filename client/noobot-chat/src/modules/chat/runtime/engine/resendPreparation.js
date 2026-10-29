/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
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
  const { attachmentFiles } = options;
  const serializedNewAttachments = await serializeAttachments(attachmentFiles);
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
    optionsAttachments: summarizeDebugAttachments(options.attachments),
    targetAttachments: summarizeDebugAttachments(userTargetMessage.attachments),
    keptAttachments: summarizeDebugAttachments(keptAttachments),
    attachmentFiles: {
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
    messages: summarizeDebugMessages(originalSession.messages),
  }));
  return { finalAttachments, pendingDisplayAttachments };
}

export async function prepareResendTransaction({
  buildMonotonicMessageAnchor,
  operationGuard,
  options,
  originalSession,
  prepareMonotonicMessageAction,
  resendTurnScopeId,
  sessionId,
  userTargetMessage,
}) {
  const prepared = await prepareMonotonicMessageAction();
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

  if (!getMessageTurnScopeId(userTargetMessage)) return REJECTED;
  const anchor = buildMonotonicMessageAnchor(userTargetMessage);

  return {
    anchor,
    finalAttachments: attachmentResolution.finalAttachments,
    oldTurnScopeId: getMessageTurnScopeId(userTargetMessage),
    pendingDisplayAttachments: attachmentResolution.pendingDisplayAttachments,
  };
}
