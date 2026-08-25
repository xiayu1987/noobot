/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { HumanMessage } from "@langchain/core/messages";
import { normalizeDialogProcessId, normalizeParentSessionId } from "@noobot/session-protocol";
import { tEngine } from "../../../runtime/i18n-adapter.js";
import { MESSAGE_ROLE } from "../../../bot/config/constants.js";
import { getTransferAttachments } from "../../../transfer-adapter/storage/consumer.js";
import { projectAttachmentMetaForModel } from "../../../artifacts/index.js";
import {
  projectContextMessageIdentityMetadata,
  deriveContextMessageProjectionId as deriveMessageProjectionId,
  readContextMessageField,
  resolveContextMessageDialogProcessId,
  resolveContextMessageRole,
} from "@noobot/context-protocol/message/codec";

export function resolveAttachments(msg = {}, fallbackAttachments = []) {
  const transferAttachments = getTransferAttachments(
    [
      ...(Array.isArray(msg?.transferEnvelopes) ? msg.transferEnvelopes : []),
      ...(Array.isArray(msg?.lc_kwargs?.transferEnvelopes) ? msg.lc_kwargs.transferEnvelopes : []),
    ].filter(Boolean),
  );
  if (transferAttachments.length) return transferAttachments;
  if (Array.isArray(msg?.attachments)) return msg.attachments;
  if (Array.isArray(msg?.additional_kwargs?.attachments)) return msg.additional_kwargs.attachments;
  if (Array.isArray(msg?.lc_kwargs?.additional_kwargs?.attachments)) {
    return msg.lc_kwargs.additional_kwargs.attachments;
  }
  return Array.isArray(fallbackAttachments) ? fallbackAttachments : [];
}

export function resolveFallbackAttachments(meta = {}) {
  if (Array.isArray(meta?.userMessageAttachments)) return meta.userMessageAttachments;
  return [];
}

export function buildHumanMessageContent(msg = {}) {
  return String(msg?.content || "");
}

function buildUserMetaAttachmentInfo(attachmentItem = {}) {
  return projectAttachmentMetaForModel(attachmentItem);
}

function buildUserMetaInfoContent(
  runtime = {},
  msg = {},
  fallbackMeta = {},
  {
    allowFallbackAttachments = true,
    allowFallbackIdentity = true,
    allowMessageAttachments = true,
    allowFallbackRoundIdentity = true,
  } = {},
) {
  const identityFallback = allowFallbackIdentity ? fallbackMeta : {};
  const fallbackAttachments = allowFallbackAttachments
    ? resolveFallbackAttachments(fallbackMeta)
    : [];
  const attachments = allowMessageAttachments ? resolveAttachments(msg, fallbackAttachments) : [];
  const fallbackParentSessionId = normalizeParentSessionId(identityFallback?.parentSessionId);
  const messageParentSessionId = normalizeParentSessionId(msg?.parentSessionId);
  const payload = {
    userName: String(msg?.userName || identityFallback?.userName || "").trim(),
    sessionId: String(msg?.sessionId || identityFallback?.sessionId || "").trim(),
    parentSessionId: messageParentSessionId ? messageParentSessionId : fallbackParentSessionId,
    dialogProcessId:
      resolveContextMessageDialogProcessId(msg) ||
      (allowFallbackRoundIdentity
        ? normalizeDialogProcessId(identityFallback?.dialogProcessId)
        : ""),
    parentDialogProcessId: String(
      msg?.parentDialogProcessId || identityFallback?.parentDialogProcessId || "",
    ).trim(),
    turnScopeId:
      resolveMessageTurnScopeId(msg) ||
      String(allowFallbackRoundIdentity ? identityFallback?.turnScopeId || "" : "").trim(),
    attachments: attachments.map((attachmentItem) => buildUserMetaAttachmentInfo(attachmentItem)),
  };
  const userMetaTag = tEngine(runtime, "agent.userMetaTag");
  return `[${userMetaTag}]\n${JSON.stringify(payload, null, 2)}\n[/${userMetaTag}]`;
}

export function buildHumanMessagesForUser(
  runtime = {},
  msg = {},
  fallbackMeta = {},
  {
    allowFallbackAttachments = true,
    allowFallbackIdentity = true,
    allowMessageAttachments = true,
    allowFallbackRoundIdentity = true,
  } = {},
) {
  const contentText = buildHumanMessageContent(msg);
  const isFrontendUserMessage = msg?.frontendUserMessage === true;
  const identityKwargs = projectContextMessageIdentityMetadata(msg);
  const userMetaMessageId = deriveMessageProjectionId(identityKwargs.noobotMessageId, "user_meta");
  const contentMessage = isFrontendUserMessage
    ? new HumanMessage({
        content: contentText,
        additional_kwargs: {
          ...identityKwargs,
          frontendUserMessage: true,
        },
      })
    : new HumanMessage({
        content: contentText,
        additional_kwargs: identityKwargs,
      });
  const metaMessage = new HumanMessage({
    content: buildUserMetaInfoContent(runtime, msg, fallbackMeta, {
      allowFallbackAttachments,
      allowFallbackIdentity,
      allowMessageAttachments,
      allowFallbackRoundIdentity,
    }),
    additional_kwargs: {
      ...identityKwargs,
      ...(userMetaMessageId ? { noobotMessageId: userMetaMessageId } : {}),
      noobotInternalMessageType: "user_meta",
    },
  });
  return [contentMessage, metaMessage];
}

export function shouldBuildUserMetaForHistoryMessage(msg = {}, runtime = {}) {
  if (resolveContextMessageRole(msg) !== MESSAGE_ROLE.USER) return false;
  const kwargs = msg?.additional_kwargs || msg?.lc_kwargs?.additional_kwargs || {};
  if (
    String(msg?.messageOrigin || kwargs?.messageOrigin || "")
      .trim()
      .toLowerCase() === "internal"
  )
    return false;
  if (msg?.phaseSummaryMemory === true) return false;
  if (
    msg?.injectedMessage === true ||
    kwargs?.injectedMessage === true ||
    msg?.pluginMessage === true ||
    kwargs?.pluginMessage === true
  )
    return false;
  if (String(msg?.injectedMessageType || kwargs?.injectedMessageType || "").trim()) return false;
  if (msg?.frontendUserMessage === true) return true;
  return Boolean(resolveContextMessageDialogProcessId(msg) && resolveMessageTurnScopeId(msg));
}

export function isDerivedUserMetaMessage(msg = {}) {
  return readContextMessageField(msg, "noobotInternalMessageType") === "user_meta";
}

export function resolveMessageTurnScopeId(msg = {}) {
  return String(
    msg?.turnScopeId ||
      msg?.additional_kwargs?.turnScopeId ||
      msg?.lc_kwargs?.turnScopeId ||
      msg?.lc_kwargs?.additional_kwargs?.turnScopeId ||
      "",
  ).trim();
}
