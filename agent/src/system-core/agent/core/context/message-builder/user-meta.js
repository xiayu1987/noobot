/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { HumanMessage } from "@langchain/core/messages";
import { tEngine } from "../../i18n-adapter.js";
import { MESSAGE_ROLE } from "../../../../bot-manage/config/constants.js";
import { getTransferAttachmentMetas } from "../../../../semantic-transfer/storage/consumer.js";
import { resolveMessageDialogProcessId, resolveDialogProcessIdFromContext } from "../../../../context/session/dialog-process-id-resolver.js";
import { normalizeParentSessionId, resolveParentSessionId } from "../../../../context/parent-session-id-resolver.js";
import { normalizeAttachmentParsedResultMeta } from "../../../../attach/index.js";
import { resolveMessageRole, buildModelMessageIdentityKwargs } from "./message-utils.js";

export function resolveAttachments(msg = {}, fallbackAttachments = []) {
  const transferAttachments = getTransferAttachmentMetas(
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

export function buildHumanMessageContent(msg = {}, fallbackAttachments = []) {
  const textContent = String(msg?.content || "");
  void fallbackAttachments;
  return textContent;
}

function buildUserMetaAttachmentInfo(attachmentItem = {}) {
  const parsedResult = normalizeAttachmentParsedResultMeta(attachmentItem);
  const size = Number(attachmentItem?.size);
  return {
    attachmentId: String(attachmentItem?.attachmentId || "").trim(),
    name: String(attachmentItem?.name || "").trim(),
    mimeType: String(attachmentItem?.mimeType || "").trim(),
    attachmentSource: String(attachmentItem?.attachmentSource || "").trim(),
    sessionId: String(attachmentItem?.sessionId || "").trim(),
    path: String(attachmentItem?.path || "").trim(),
    relativePath: String(attachmentItem?.relativePath || "").trim(),
    sandboxPath: String(attachmentItem?.sandboxPath || "").trim(),
    downloadUrl: String(attachmentItem?.downloadUrl || "").trim(),
    previewUrl: String(attachmentItem?.previewUrl || "").trim(),
    parsedResultUrl: String(attachmentItem?.parsedResultUrl || "").trim(),
    parsedResultName: String(attachmentItem?.parsedResultName || "").trim(),
    parsedResultAttachmentId: String(attachmentItem?.parsedResultAttachmentId || "").trim(),
    transferFilePath: String(attachmentItem?.transferFilePath || "").trim(),
    ...(String(attachmentItem?.clientAttachmentId || "").trim()
      ? { clientAttachmentId: String(attachmentItem.clientAttachmentId).trim() }
      : {}),
    ...(Number.isFinite(size) ? { size } : {}),
    ...(typeof attachmentItem?.isSandbox === "boolean" ? { isSandbox: attachmentItem.isSandbox } : {}),
    ...(parsedResult ? { parsedResult } : {}),
  };
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
  const fallbackParentSessionId = resolveParentSessionId({
    runtime,
    parentSessionId: identityFallback?.parentSessionId,
  });
  const messageParentSessionId = normalizeParentSessionId(msg?.parentSessionId);
  const payload = {
    userName: String(msg?.userName || identityFallback?.userName || "").trim(),
    sessionId: String(msg?.sessionId || identityFallback?.sessionId || "").trim(),
    parentSessionId: messageParentSessionId
      ? messageParentSessionId
      : fallbackParentSessionId,
    dialogProcessId:
      resolveMessageDialogProcessId(msg) ||
      (allowFallbackRoundIdentity
        ? resolveDialogProcessIdFromContext({
            dialogProcessId: identityFallback?.dialogProcessId,
          })
        : ""),
    parentDialogProcessId: String(
      msg?.parentDialogProcessId || identityFallback?.parentDialogProcessId || "",
    ).trim(),
    turnScopeId: String(
      msg?.turnScopeId || (allowFallbackRoundIdentity ? identityFallback?.turnScopeId : "") || "",
    ).trim(),
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
  const contentText = buildHumanMessageContent(
    msg,
    resolveFallbackAttachments(fallbackMeta),
  );
  const isFrontendUserMessage = msg?.frontendUserMessage === true;
  const identityKwargs = buildModelMessageIdentityKwargs(msg, fallbackMeta);
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
      noobotInternalMessageType: "user_meta",
    },
  });
  return [contentMessage, metaMessage];
}

export function shouldBuildUserMetaForHistoryMessage(
  msg = {},
  runtime = {},
  { restorableUserMetaKeys = null } = {},
) {
  if (resolveMessageRole(msg) !== MESSAGE_ROLE.USER) return false;
  const kwargs = msg?.additional_kwargs || msg?.lc_kwargs?.additional_kwargs || {};
  if (String(msg?.messageOrigin || kwargs?.messageOrigin || "").trim().toLowerCase() === "internal") return false;
  if (msg?.phaseSummaryMemory === true) return false;
  if (
    msg?.injectedMessage === true || kwargs?.injectedMessage === true ||
    msg?.pluginMessage === true || kwargs?.pluginMessage === true
  ) return false;
  if (String(
    msg?.injectedMessageType || msg?.injected_message_type ||
    kwargs?.injectedMessageType || kwargs?.injected_message_type || "",
  ).trim()) return false;
  if (msg?.frontendUserMessage === true) return true;
  const identityKey = buildUserSourceIdentityKey(msg);
  if (identityKey && restorableUserMetaKeys?.has?.(identityKey)) return true;
  // Legacy stopped/resend snapshots may not have the frontend marker. Their
  // full round identity remains the compatibility signal; injected messages
  // are rejected above using the semantics preserved in additional_kwargs.
  return Boolean(resolveMessageDialogProcessId(msg) && resolveMessageTurnScopeId(msg));
}

export function isDerivedUserMetaMessage(msg = {}, runtime = {}) {
  const internalType = String(
    msg?.additional_kwargs?.noobotInternalMessageType ||
      msg?.lc_kwargs?.additional_kwargs?.noobotInternalMessageType ||
      msg?.metadata?.noobotInternalMessageType ||
      "",
  ).trim();
  if (internalType === "user_meta") return true;
  const content = String(msg?.content || "").trimStart();
  const localizedTag = String(tEngine(runtime, "agent.userMetaTag") || "").trim();
  return Boolean(
    content.startsWith("[用户元信息]") ||
      content.startsWith("[User Metadata]") ||
      (localizedTag && content.startsWith(`[${localizedTag}]`))
  );
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

function buildUserSourceIdentityKey(msg = {}) {
  const dialogProcessId = resolveMessageDialogProcessId(msg);
  const turnScopeId = resolveMessageTurnScopeId(msg);
  if (!dialogProcessId || !turnScopeId) return "";
  return `${dialogProcessId}\u0000${turnScopeId}`;
}

function parseDerivedUserMeta(msg = {}, runtime = {}) {
  if (!isDerivedUserMetaMessage(msg, runtime)) return null;
  const content = String(msg?.content || "");
  const jsonStart = content.indexOf("{");
  const jsonEnd = content.lastIndexOf("}");
  if (jsonStart < 0 || jsonEnd < jsonStart) return null;
  try {
    const parsed = JSON.parse(content.slice(jsonStart, jsonEnd + 1));
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

export function buildRestoredUserMetaIndex(messages = [], runtime = {}) {
  const index = new Map();
  for (const msg of Array.isArray(messages) ? messages : []) {
    const parsed = parseDerivedUserMeta(msg, runtime);
    if (!parsed) continue;
    const key = buildUserSourceIdentityKey({
      dialogProcessId: parsed.dialogProcessId || resolveMessageDialogProcessId(msg),
      turnScopeId: parsed.turnScopeId || resolveMessageTurnScopeId(msg),
    });
    if (!key) continue;
    index.set(key, parsed);
  }
  return index;
}

export function buildRestorableUserMetaKeys(messages = [], runtime = {}) {
  const metaIndex = buildRestoredUserMetaIndex(messages, runtime);
  const keys = new Set();
  for (const msg of Array.isArray(messages) ? messages : []) {
    if (isDerivedUserMetaMessage(msg, runtime)) continue;
    if (resolveMessageRole(msg) !== MESSAGE_ROLE.USER) continue;
    const key = buildUserSourceIdentityKey(msg);
    if (key && metaIndex.has(key)) keys.add(key);
  }
  return keys;
}

function canRestoreUserMetaProjection(parsedMeta = null, msg = {}, messages = []) {
  if (!parsedMeta) return false;
  const dialogProcessId = String(
    parsedMeta.dialogProcessId || resolveMessageDialogProcessId(msg) || "",
  ).trim();
  const turnScopeId = String(
    parsedMeta.turnScopeId || resolveMessageTurnScopeId(msg) || "",
  ).trim();
  if (!dialogProcessId && !turnScopeId) return true;
  return (Array.isArray(messages) ? messages : []).some((source) => {
    if (isDerivedUserMetaMessage(source, {})) return false;
    if (resolveMessageRole(source) !== MESSAGE_ROLE.USER) return false;
    const sourceDialog = resolveMessageDialogProcessId(source);
    const sourceTurn = resolveMessageTurnScopeId(source);
    return (!dialogProcessId || sourceDialog === dialogProcessId) &&
      (!turnScopeId || sourceTurn === turnScopeId);
  });
}

export function normalizeRestoredUserSource(msg = {}, restoredUserMetaIndex = new Map()) {
  if (resolveMessageRole(msg) !== MESSAGE_ROLE.USER) return msg;
  const dialogProcessId = resolveMessageDialogProcessId(msg);
  const turnScopeId = resolveMessageTurnScopeId(msg);
  const restoredMeta = restoredUserMetaIndex.get(buildUserSourceIdentityKey({
    dialogProcessId,
    turnScopeId,
  }));
  const sourceAttachments = resolveAttachments(msg, []);
  const restoredAttachments = Array.isArray(restoredMeta?.attachments)
    ? restoredMeta.attachments
    : [];
  const restoreStringField = (fieldName) => {
    const sourceValue = String(msg?.[fieldName] || "").trim();
    const restoredValue = String(restoredMeta?.[fieldName] || "").trim();
    return sourceValue || restoredValue;
  };
  const userName = restoreStringField("userName");
  const sessionId = restoreStringField("sessionId");
  const parentSessionId = restoreStringField("parentSessionId");
  const parentDialogProcessId = restoreStringField("parentDialogProcessId");
  return {
    ...msg,
    ...(userName ? { userName } : {}),
    ...(sessionId ? { sessionId } : {}),
    ...(parentSessionId ? { parentSessionId } : {}),
    ...(dialogProcessId ? { dialogProcessId } : {}),
    ...(parentDialogProcessId ? { parentDialogProcessId } : {}),
    ...(turnScopeId ? { turnScopeId } : {}),
    ...(!sourceAttachments.length && restoredAttachments.length
      ? { attachments: restoredAttachments }
      : {}),
  };
}

