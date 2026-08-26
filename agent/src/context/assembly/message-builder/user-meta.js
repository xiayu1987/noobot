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
  resolveContextMessageOrigin,
  resolveContextMessageRole,
  resolveContextUserMetaMaterialized,
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
  const isNaturalUserMessage = resolveContextMessageOrigin(msg) === "natural";
  const identityKwargs = projectContextMessageIdentityMetadata(msg);
  const userMetaMessageId = deriveMessageProjectionId(identityKwargs.noobotMessageId, "user_meta");
  const contentMessage = isNaturalUserMessage
    ? new HumanMessage({
        content: contentText,
        additional_kwargs: identityKwargs,
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
  const messageOrigin = resolveContextMessageOrigin(msg);
  const injectedMessage = readContextMessageField(msg, "injectedMessage").toLowerCase() === "true";
  const pluginMessage = readContextMessageField(msg, "pluginMessage").toLowerCase() === "true";
  const injectedMessageType = readContextMessageField(msg, "injectedMessageType");
  if (messageOrigin === "internal") return false;
  if (msg?.phaseSummaryMemory === true) return false;
  if (injectedMessage || pluginMessage) return false;
  if (injectedMessageType) return false;
  return messageOrigin === "natural" && resolveContextUserMetaMaterialized(msg);
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

function parseUserMetaPayload(content = "") {
  const source = String(content || "");
  const jsonStart = source.indexOf("{");
  const jsonEnd = source.lastIndexOf("}");
  if (jsonStart < 0 || jsonEnd < jsonStart) {
    throw new Error("user_meta content does not contain a JSON payload");
  }
  const payload = JSON.parse(source.slice(jsonStart, jsonEnd + 1));
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    throw new Error("user_meta payload must be an object");
  }
  return { source, jsonStart, jsonEnd, payload };
}

export function appendUserMetaParsedResult(content = "", result = {}) {
  if (!result || typeof result !== "object" || Array.isArray(result)) {
    throw new TypeError("user_meta parsed result must be an object");
  }
  const parsed = parseUserMetaPayload(content);
  const currentResults = Array.isArray(parsed.payload.parsedResults)
    ? parsed.payload.parsedResults
    : [];
  const resultRef = String(result.sourceAttachmentRef || "").trim();
  if (!resultRef) throw new TypeError("user_meta parsed result requires sourceAttachmentRef");
  const nextResults = currentResults.filter(
    (item) => String(item?.sourceAttachmentRef || "").trim() !== resultRef,
  );
  nextResults.push({ ...result });
  parsed.payload.parsedResults = nextResults;
  return `${parsed.source.slice(0, parsed.jsonStart)}${JSON.stringify(parsed.payload, null, 2)}${parsed.source.slice(parsed.jsonEnd + 1)}`;
}
