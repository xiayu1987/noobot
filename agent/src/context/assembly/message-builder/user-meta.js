/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { HumanMessage } from "@langchain/core/messages";
import { MESSAGE_ORIGIN, normalizeParentSessionId } from "@noobot/session-protocol";
import { tEngine } from "../../../runtime/i18n-adapter.js";
import { MESSAGE_ROLE } from "../../../bot/config/constants.js";
import { getTransferAttachments } from "../../../transfer-adapter/storage/consumer.js";
import { projectAttachmentMetaForModel } from "../../../artifacts/index.js";
import {
  CONTEXT_MESSAGE_PROJECTION_TYPE,
  projectContextMessageModelMetadata,
  readContextMessageField,
  readContextMessageValue,
  resolveContextMessageFlags,
  resolveContextSessionMessageUid,
  resolveContextMessageTurnScopeId,
  resolveContextMessageDialogProcessId,
  resolveContextMessageOrigin,
  resolveContextMessageRole,
} from "@noobot/context-protocol/message/codec";
import { CONTEXT_INTERNAL_MESSAGE_TYPE } from "@noobot/context-protocol/message/internal-types";

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
  const parsedResults = readContextMessageArray(msg, "userMetaParsedResults");
  if (parsedResults.length) payload.parsedResults = parsedResults;
  const userMetaTag = tEngine(runtime, "agent.userMetaTag");
  return `[${userMetaTag}]\n${JSON.stringify(payload, null, 2)}\n[/${userMetaTag}]`;
}

export function buildHumanMessagesForUser(runtime = {}, msg = {}) {
  const messageUid = resolveContextSessionMessageUid(msg);
  if (!messageUid) throw new Error("user context message requires additional_kwargs.messageUid");
  const metadata = projectContextMessageModelMetadata(msg);
  const projectionMetadata = Object.fromEntries(
    Object.entries(metadata).filter(([key]) => key !== "messageUid"),
  );
  const contentMessage = new HumanMessage({
    content: buildHumanMessageContent(msg),
    additional_kwargs: metadata,
  });
  const metaMessage = new HumanMessage({
    content: buildUserMetaInfoContent(runtime, msg),
    additional_kwargs: {
      ...projectionMetadata,
      projectionType: CONTEXT_MESSAGE_PROJECTION_TYPE.USER_META,
      sourceMessageUid: messageUid,
      noobotInternalMessageType: CONTEXT_INTERNAL_MESSAGE_TYPE.USER_META,
    },
  });
  return [contentMessage, metaMessage];
}

export function shouldBuildUserMetaForHistoryMessage(msg = {}) {
  if (resolveContextMessageRole(msg) !== MESSAGE_ROLE.USER) return false;
  if (resolveContextMessageOrigin(msg) !== MESSAGE_ORIGIN.NATURAL) return false;
  if (readContextMessageField(msg, "noobotInternalMessageType")) return false;
  const flags = resolveContextMessageFlags(msg);
  return !flags.injected && !flags.plugin;
}

export function isDerivedUserMetaMessage(msg = {}) {
  return (
    readContextMessageField(msg, "noobotInternalMessageType") ===
    CONTEXT_INTERNAL_MESSAGE_TYPE.USER_META
  );
}
