/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

import { LENGTH_THRESHOLDS } from "@noobot/shared/length-thresholds";
import { isPlainObject } from "../../shared/utils/shared-utils.js";

const SESSION_TURN_FULL_CONTENT_PREVIEW_CHARS =
  LENGTH_THRESHOLDS.display.sessionSummaryArrayItemChars;
const SESSION_TURN_FULL_RAW_MODEL_PREVIEW_CHARS =
  LENGTH_THRESHOLDS.display.sessionSummaryArrayItemChars;

function previewString(value = "", maxChars = SESSION_TURN_FULL_CONTENT_PREVIEW_CHARS) {
  const text = String(value || "");
  if (text.length <= maxChars) return text;
  return `${text.slice(0, maxChars)}…`;
}

function byteLengthOfJson(value = null) {
  try {
    return Buffer.byteLength(JSON.stringify(value ?? null), "utf8");
  } catch {
    return 0;
  }
}

function summarizeArray(value = []) {
  return {
    count: Array.isArray(value) ? value.length : 0,
    bytes: byteLengthOfJson(Array.isArray(value) ? value : []),
  };
}

function summarizeObject(value = null) {
  if (!isPlainObject(value)) return { present: false, bytes: 0, keys: [] };
  return {
    present: true,
    bytes: byteLengthOfJson(value),
    keys: Object.keys(value).slice(0, 20),
  };
}

function summarizeRawModelContent(value = null) {
  if (typeof value === "string") {
    return {
      kind: "string",
      present: value.length > 0,
      length: value.length,
      preview: previewString(value, SESSION_TURN_FULL_RAW_MODEL_PREVIEW_CHARS),
    };
  }
  if (Array.isArray(value)) {
    return { kind: "array", present: value.length > 0, ...summarizeArray(value) };
  }
  return { kind: "none", present: false, length: 0 };
}

export function summarizeSessionTurnPayload(fullTurnPayload = {}) {
  const content = String(fullTurnPayload?.content || "");
  return {
    summaryVersion: 1,
    role: fullTurnPayload.role,
    type: fullTurnPayload.type || "",
    taskId: fullTurnPayload.taskId ?? "",
    taskStatus: fullTurnPayload.taskStatus ?? "",
    dialogProcessId: fullTurnPayload.dialogProcessId || "",
    parentDialogProcessId: fullTurnPayload.parentDialogProcessId || "",
    turnScopeId: fullTurnPayload.turnScopeId || "",
    content: {
      length: content.length,
      bytes: Buffer.byteLength(content, "utf8"),
      preview: previewString(content),
      truncated: content.length > SESSION_TURN_FULL_CONTENT_PREVIEW_CHARS,
    },
    toolCalls: summarizeArray(fullTurnPayload.tool_calls),
    toolCallId: fullTurnPayload.tool_call_id || "",
    attachments: summarizeArray(fullTurnPayload.attachments),
    transferEnvelopes: summarizeArray(fullTurnPayload.transferEnvelopes),
    modelAlias: fullTurnPayload.modelAlias || "",
    modelName: fullTurnPayload.modelName || "",
    summarized: fullTurnPayload.summarized === true,
    toolName: fullTurnPayload.toolName || "",
    rawModelContent: summarizeRawModelContent(fullTurnPayload.rawModelContent),
    modelAdditionalKwargs: summarizeObject(fullTurnPayload.modelAdditionalKwargs),
    modelResponseMetadata: summarizeObject(fullTurnPayload.modelResponseMetadata),
    injectedMessage: fullTurnPayload.injectedMessage === true,
    injectedBy: fullTurnPayload.injectedBy || "",
    injectedMessageType: fullTurnPayload.injectedMessageType || "",
    messageOrigin: fullTurnPayload.messageOrigin || "",
    userMetaMaterialized: fullTurnPayload.userMetaMaterialized === true,
    pluginMessage: fullTurnPayload.pluginMessage === true,
    pluginMeta: summarizeObject(fullTurnPayload.pluginMeta),
    isMonotonic: fullTurnPayload.isMonotonic === true,
    monotonic: fullTurnPayload.monotonic === true,
    artifactRef: {
      kind: "session_turn",
      source: "session.messages",
      dialogProcessId: fullTurnPayload.dialogProcessId || "",
      turnScopeId: fullTurnPayload.turnScopeId || "",
    },
  };
}
