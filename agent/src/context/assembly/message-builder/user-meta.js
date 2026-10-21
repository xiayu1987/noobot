/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { HumanMessage } from "@langchain/core/messages";
import { normalizeParentSessionId } from "@noobot/session-protocol";
import { tEngine } from "../../../runtime/i18n-adapter.js";
import { MESSAGE_ROLE } from "../../../bot/config/constants.js";
import { getTransferAttachments } from "../../../transfer-adapter/storage/consumer.js";
import { projectAttachmentMetaForModel } from "../../../artifacts/index.js";
import {
  CONTEXT_MESSAGE_PROJECTION_TYPE,
  deriveContextMessageProjectionId,
  projectContextMessageModelMetadata,
  readContextMessageField,
  readContextMessageValue,
  resolveContextMessageFlags,
  resolveContextMessageId,
  resolveContextMessageTurnScopeId,
  resolveContextMessageDialogProcessId,
  resolveContextMessageOrigin,
  resolveContextMessageRole,
  resolveContextUserMetaMaterialized,
} from "@noobot/context-protocol/message/codec";
import { CONTEXT_INTERNAL_MESSAGE_TYPE } from "@noobot/context-protocol/message/internal-types";
import { text, isPlainObject } from "@noobot/shared/value";

function readContextMessageArray(msg = {}, field = "") {
  const value = readContextMessageValue(msg, field);
  return Array.isArray(value) ? value : [];
}

export function resolveAttachments(msg = {}) {
  const transferAttachments = getTransferAttachments(
    readContextMessageArray(msg, "transferEnvelopes").filter(Boolean),
  );
  if (transferAttachments.length) return transferAttachments;
  return readContextMessageArray(msg, "attachments");
}

export function buildHumanMessageContent(msg = {}) {
  return String(msg?.content || "");
}

function buildUserMetaAttachmentInfo(attachmentItem = {}) {
  return projectAttachmentMetaForModel(attachmentItem);
}

function buildUserMetaInfoContent(runtime = {}, msg = {}) {
  const payload = {
    userName: readContextMessageField(msg, "userName"),
    sessionId: readContextMessageField(msg, "sessionId"),
    parentSessionId: normalizeParentSessionId(readContextMessageField(msg, "parentSessionId")),
    dialogProcessId: resolveContextMessageDialogProcessId(msg),
    parentDialogProcessId: readContextMessageField(msg, "parentDialogProcessId"),
    turnScopeId: resolveContextMessageTurnScopeId(msg),
    attachments: resolveAttachments(msg).map((attachmentItem) =>
      buildUserMetaAttachmentInfo(attachmentItem),
    ),
  };
  const userMetaTag = tEngine(runtime, "agent.userMetaTag");
  return `[${userMetaTag}]\n${JSON.stringify(payload, null, 2)}\n[/${userMetaTag}]`;
}

export function buildHumanMessagesForUser(runtime = {}, msg = {}) {
  const messageUid = resolveContextMessageId(msg);
  if (!messageUid) throw new Error("user context message requires additional_kwargs.messageUid");
  const metadata = projectContextMessageModelMetadata(msg);
  const contentMessage = new HumanMessage({
    content: buildHumanMessageContent(msg),
    additional_kwargs: metadata,
  });
  const metaMessage = new HumanMessage({
    content: buildUserMetaInfoContent(runtime, msg),
    additional_kwargs: {
      ...metadata,
      messageUid: deriveContextMessageProjectionId(
        messageUid,
        CONTEXT_MESSAGE_PROJECTION_TYPE.USER_META,
      ),
      noobotInternalMessageType: CONTEXT_INTERNAL_MESSAGE_TYPE.USER_META,
    },
  });
  return [contentMessage, metaMessage];
}

export function shouldBuildUserMetaForHistoryMessage(msg = {}) {
  if (resolveContextMessageRole(msg) !== MESSAGE_ROLE.USER) return false;
  const messageOrigin = resolveContextMessageOrigin(msg);
  if (messageOrigin !== "natural") return false;
  if (readContextMessageField(msg, "noobotInternalMessageType")) return false;
  const flags = resolveContextMessageFlags(msg);
  if (flags.injected || flags.plugin) return false;
  return resolveContextUserMetaMaterialized(msg);
}

export function isDerivedUserMetaMessage(msg = {}) {
  return (
    readContextMessageField(msg, "noobotInternalMessageType") ===
    CONTEXT_INTERNAL_MESSAGE_TYPE.USER_META
  );
}

function parseUserMetaPayload(content = "") {
  const source = String(content || "");
  const jsonStart = source.indexOf("{");
  const jsonEnd = source.lastIndexOf("}");
  if (jsonStart < 0 || jsonEnd < jsonStart) {
    throw new Error("user_meta content does not contain a JSON payload");
  }
  const payload = JSON.parse(source.slice(jsonStart, jsonEnd + 1));
  if (!isPlainObject(payload)) {
    throw new Error("user_meta payload must be an object");
  }
  return { source, jsonStart, jsonEnd, payload };
}

export function appendUserMetaParsedResult(content = "", result = {}) {
  if (!isPlainObject(result)) {
    throw new TypeError("user_meta parsed result must be an object");
  }
  const parsed = parseUserMetaPayload(content);
  const currentResults = Array.isArray(parsed.payload.parsedResults)
    ? parsed.payload.parsedResults
    : [];
  const resultRef = text(result.sourceAttachmentRef);
  if (!resultRef) throw new TypeError("user_meta parsed result requires sourceAttachmentRef");
  const nextResults = currentResults.filter(
    (item) => text(item?.sourceAttachmentRef) !== resultRef,
  );
  nextResults.push({ ...result });
  parsed.payload.parsedResults = nextResults;
  return `${parsed.source.slice(0, parsed.jsonStart)}${JSON.stringify(parsed.payload, null, 2)}${parsed.source.slice(parsed.jsonEnd + 1)}`;
}
