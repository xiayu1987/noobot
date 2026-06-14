/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import path from "node:path";
import { mkdir, writeFile } from "node:fs/promises";
import {
  resolveMessageRole,
} from "../../context/session/message-context-policy.js";
import { extractMessageTextContent } from "../../context/session/message-content-utils.js";
import {
  resolveDialogProcessId,
  resolveMessageDialogProcessId,
} from "../../context/session/dialog-process-id-resolver.js";
import { compactToolResultTextForModel } from "../../semantic-transfer/core/compact.js";
import { getTransferAttachmentMetas } from "../../semantic-transfer/storage/consumer.js";

export function normalizePluginSelectorSet(keys = []) {
  return new Set(normalizeTrimmedStringList(keys));
}

export function resolvePluginOptionsFromConfig(sourceConfig = {}, pluginSelectors = new Set()) {
  const plugins =
    sourceConfig?.plugins && typeof sourceConfig.plugins === "object" ? sourceConfig.plugins : {};
  const merged = {};
  for (const selector of pluginSelectors) {
    const item = plugins?.[selector];
    if (!item || typeof item !== "object") continue;
    Object.assign(merged, item);
  }
  return merged;
}

export function normalizeMessageForModelRuntime(messageItem = {}) {
  const role = resolveMessageRole(messageItem);
  if (!role) return null;
  const content = extractMessageTextContent(
    messageItem?.content ?? messageItem?.lc_kwargs?.content ?? "",
  );
  const normalized = {
    role,
    content: role === "tool" ? compactToolResultTextForModel(content) : content,
    summarized:
      messageItem?.summarized === true || messageItem?.lc_kwargs?.summarized === true,
  };
  const toolCalls = Array.isArray(messageItem?.tool_calls)
    ? messageItem.tool_calls
    : Array.isArray(messageItem?.lc_kwargs?.tool_calls)
      ? messageItem.lc_kwargs.tool_calls
      : Array.isArray(messageItem?.additional_kwargs?.tool_calls)
        ? messageItem.additional_kwargs.tool_calls
        : [];
  if (toolCalls.length) normalized.tool_calls = toolCalls;
  const toolCallId = String(
    messageItem?.tool_call_id || messageItem?.lc_kwargs?.tool_call_id || "",
  ).trim();
  if (toolCallId) normalized.tool_call_id = toolCallId;
  const internalType = String(
    messageItem?.additional_kwargs?.noobotInternalMessageType ||
      messageItem?.lc_kwargs?.additional_kwargs?.noobotInternalMessageType ||
      messageItem?.metadata?.noobotInternalMessageType ||
      messageItem?.lc_kwargs?.metadata?.noobotInternalMessageType ||
      "",
  ).trim();
  if (internalType) {
    normalized.additional_kwargs = {
      ...(normalized.additional_kwargs || {}),
      noobotInternalMessageType: internalType,
    };
  }
  const dialogProcessId = resolveMessageDialogProcessId(messageItem);
  if (dialogProcessId) normalized.dialogProcessId = dialogProcessId;
  return applyNormalizedMessageFlags(normalized, messageItem);
}

export function resolveMessageBlockDialogProcessId({ scope = "", ctx = {}, messages = [] } = {}) {
  const normalizedScope = String(scope || "").trim().toLowerCase();
  if (
    normalizedScope === "incremental" ||
    normalizedScope === "conversation" ||
    normalizedScope === "non_system"
  ) {
    const fromCurrentTurnMessages = resolveCurrentTurnDialogProcessIdFromMessages(messages);
    if (fromCurrentTurnMessages) return fromCurrentTurnMessages;
  }
  return resolveDialogProcessId({ ctx, messages });
}

export function isPlainObject(value) {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

export function resolveTransferEnvelopesFromMessage(message = {}) {
  const transferEnvelope = resolveTransferEnvelopeFromMessage(message);
  const transferResult = resolveTransferResultFromMessage(message);
  const transferResultEnvelope = isPlainObject(transferResult?.envelope)
    ? transferResult.envelope
    : null;
  return [
    transferEnvelope,
    transferResultEnvelope,
    ...resolveTransferEnvelopeListFromMessage(message),
  ].filter(isPlainObject);
}

export function resolveTransferEnvelopeFromMessage(message = {}) {
  if (isPlainObject(message?.transferEnvelope)) return message.transferEnvelope;
  if (isPlainObject(message?.lc_kwargs?.transferEnvelope)) return message.lc_kwargs.transferEnvelope;
  return null;
}

export function resolveTransferResultFromMessage(message = {}) {
  if (isPlainObject(message?.transferResult)) return message.transferResult;
  if (isPlainObject(message?.lc_kwargs?.transferResult)) return message.lc_kwargs.transferResult;
  return null;
}

export function resolveTransferEnvelopeListFromMessage(message = {}) {
  const transferEnvelopes = [
    ...(Array.isArray(message?.transferEnvelopes) ? message.transferEnvelopes : []),
    ...(Array.isArray(message?.lc_kwargs?.transferEnvelopes) ? message.lc_kwargs.transferEnvelopes : []),
  ].filter(isPlainObject);
  return transferEnvelopes;
}

export function resolvePreferredAttachmentMetas(message = {}) {
  const transferAttachmentMetas = getTransferAttachmentMetas(resolveTransferEnvelopesFromMessage(message));
  if (transferAttachmentMetas.length) return transferAttachmentMetas;
  if (Array.isArray(message?.attachmentMetas)) return message.attachmentMetas;
  if (Array.isArray(message?.lc_kwargs?.attachmentMetas)) return message.lc_kwargs.attachmentMetas;
  return [];
}

export function normalizeTrimmedStringList(input = []) {
  return (Array.isArray(input) ? input : [])
    .map((item) => String(item || "").trim())
    .filter(Boolean);
}

export function applyNormalizedMessageFlags(normalized = {}, messageItem = {}) {
  if (messageItem?.injectedMessage === true || messageItem?.lc_kwargs?.injectedMessage === true) {
    normalized.injectedMessage = true;
  }
  const injectedBy = String(
    messageItem?.injectedBy || messageItem?.lc_kwargs?.injectedBy || "",
  ).trim();
  if (injectedBy) normalized.injectedBy = injectedBy;
  const injectedMessageType = String(
    messageItem?.injectedMessageType ||
      messageItem?.injected_message_type ||
      messageItem?.lc_kwargs?.injectedMessageType ||
      messageItem?.lc_kwargs?.injected_message_type ||
      "",
  ).trim();
  if (injectedMessageType) normalized.injectedMessageType = injectedMessageType;
  if (isFrontendUserMessageFlagged(messageItem)) {
    normalized.frontendUserMessage = true;
  }
  return normalized;
}

export function selectHookManager({
  runConfig = {},
  managerKey = "",
  hooksKey = "",
  createManager = null,
} = {}) {
  if (runConfig?.[managerKey] && typeof runConfig[managerKey] === "object") {
    return runConfig[managerKey];
  }
  if (
    runConfig?.[hooksKey] &&
    typeof runConfig[hooksKey] === "object" &&
    typeof runConfig[hooksKey].on === "function"
  ) {
    return runConfig[hooksKey];
  }
  return typeof createManager === "function" ? createManager() : null;
}

export async function persistSnapshotJsonFiles({
  outputDir = "",
  sessionPayload = {},
  taskPayload = {},
  executionPayload = {},
  metadata = null,
} = {}) {
  await mkdir(outputDir, { recursive: true });
  const files = buildSnapshotFileMap(outputDir);
  await Promise.all([
    writeJsonFile(files.session, sessionPayload),
    writeJsonFile(files.task, taskPayload),
    writeJsonFile(files.execution, executionPayload),
    writeJsonFile(files.meta, metadata && typeof metadata === "object" ? metadata : {}),
  ]);
  return {
    outputDir,
    files,
  };
}

function isInjectedMessageLike(messageItem = {}) {
  if (!messageItem || typeof messageItem !== "object") return false;
  if (messageItem?.injectedMessage === true || messageItem?.lc_kwargs?.injectedMessage === true) return true;
  return Boolean(String(messageItem?.injectedBy || messageItem?.lc_kwargs?.injectedBy || "").trim());
}

function isFrontendUserMessageFlagged(messageItem = {}) {
  return (
    messageItem?.frontendUserMessage === true ||
    messageItem?.lc_kwargs?.frontendUserMessage === true ||
    messageItem?.additional_kwargs?.frontendUserMessage === true ||
    messageItem?.lc_kwargs?.additional_kwargs?.frontendUserMessage === true
  );
}

function resolveCurrentTurnDialogProcessIdFromMessages(messages = []) {
  const source = Array.isArray(messages) ? messages : [];
  for (let index = source.length - 1; index >= 0; index -= 1) {
    const item = source[index] || {};
    if (!isFrontendUserMessageFlagged(item)) continue;
    const dialogProcessId = resolveMessageDialogProcessId(item);
    if (dialogProcessId) return dialogProcessId;
  }
  for (let index = source.length - 1; index >= 0; index -= 1) {
    const item = source[index] || {};
    if (!isInjectedMessageLike(item)) continue;
    const dialogProcessId = resolveMessageDialogProcessId(item);
    if (dialogProcessId) return dialogProcessId;
  }
  return "";
}

function buildSnapshotFileMap(outputDir = "") {
  return {
    session: path.join(outputDir, "session.json"),
    task: path.join(outputDir, "task.json"),
    execution: path.join(outputDir, "execution.json"),
    meta: path.join(outputDir, "meta.json"),
  };
}

async function writeJsonFile(filePath = "", payload = {}) {
  await writeFile(
    filePath,
    `${JSON.stringify(payload && typeof payload === "object" ? payload : {}, null, 2)}\n`,
    "utf8",
  );
}
