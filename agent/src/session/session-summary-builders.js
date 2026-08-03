/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

import { LENGTH_THRESHOLDS } from "@noobot/shared/length-thresholds";
import { createAuthoritativeTurnSnapshot } from "@noobot/authoritative-state/application";
import {
  collectAttachmentRefsFromTransferEnvelopes,
  compactAttachmentRef,
  compactTransferEnvelopes,
  dedupeAttachmentRefs,
} from "./transfer-attachment-refs.js";

export const SESSION_DISPLAY_SUMMARY_SCHEMA_VERSION = 16;
export const SESSION_DETAIL_MESSAGE_PROJECTION = "canonical-presentation";
const REQUIRED_MESSAGE_SUMMARY_KEYS = new Set(["turnScopeId"]);
const SUMMARY_ARRAY_ITEM_CHARS = LENGTH_THRESHOLDS.display.sessionSummaryArrayItemChars;
const SUMMARY_OBJECT_FIELD_CHARS = LENGTH_THRESHOLDS.display.sessionSummaryObjectFieldChars;
const SUMMARY_DEFAULT_JSON_STRING_CHARS =
  LENGTH_THRESHOLDS.display.sessionSummaryDefaultJsonStringChars;
const SUMMARY_SMALL_JSON_STRING_CHARS =
  LENGTH_THRESHOLDS.display.sessionSummarySmallJsonStringChars;
const SUMMARY_FILE_NAME_CHARS = LENGTH_THRESHOLDS.display.sessionSummaryFileNameChars;

export function isSessionDisplaySummaryPayload(payload = null, sessionId = "") {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return false;
  if (Number(payload?.schemaVersion || 0) !== SESSION_DISPLAY_SUMMARY_SCHEMA_VERSION) return false;
  const normalizedSessionId = String(sessionId || "").trim();
  if (normalizedSessionId && String(payload?.sessionId || "").trim() !== normalizedSessionId) return false;
  return true;
}

function compactMessageSummary(summary = {}) {
  return Object.fromEntries(
    Object.entries(summary).filter(
      ([key, value]) => REQUIRED_MESSAGE_SUMMARY_KEYS.has(key) || value !== "",
    ),
  );
}

export function buildSessionSummary(session = {}, { depth = 0 } = {}) {
  const sessionId = String(session?.sessionId || "").trim();
  const messages = Array.isArray(session?.messages) ? session.messages : [];
  const firstUserMessage = messages.find(
    (messageItem) =>
      messageItem?.injectedMessage !== true &&
      String(messageItem?.role || "").trim().toLowerCase() === "user" &&
      String(messageItem?.content || "").trim(),
  );
  const lastMessage = messages.length ? buildMessageSummary(messages[messages.length - 1]) : null;
  const customTitle = String(session?.customTitle || "").trim();
  return {
    sessionId,
    parentSessionId: String(session?.parentSessionId || "").trim(),
    caller: String(session?.caller || "user").trim() || "user",
    currentTaskId: String(session?.currentTaskId || "").trim(),
    createdAt: String(session?.createdAt || "").trim(),
    updatedAt: String(session?.updatedAt || "").trim(),
    depth: Number.isFinite(Number(depth)) ? Number(depth) : 0,
    title: customTitle || (firstUserMessage
      ? String(firstUserMessage.content || "").slice(0, 20)
      : sessionId.slice(0, 8)),
    messageCount: messages.length,
    lastMessage,
  };
}

function buildMessageSummary(message = {}) {
  if (!message || typeof message !== "object" || Array.isArray(message)) return null;
  const summary = {
    role: String(message?.role || "").trim(),
    content: message?.content || "",
    type: String(message?.type || "").trim(),
    dialogProcessId: String(message?.dialogProcessId || "").trim(),
    parentDialogProcessId: String(message?.parentDialogProcessId || "").trim(),
    taskId: String(message?.taskId || "").trim(),
    taskStatus: String(message?.taskStatus || "").trim(),
    modelAlias: String(message?.modelAlias || "").trim(),
    modelName: String(message?.modelName || "").trim(),
    summarized: message?.summarized === true,
    ts: String(message?.ts || "").trim(),
  };
  for (const key of [
    "injectedMessage",
    "injectedBy",
    "injectedMessageType",
    "frontendUserMessage",
    "chatPresentation",
    "presentationMessageId",
    "isMonotonic",
    "monotonic",
    "pluginMessage",
    "tool_call_id",
    "toolName",
    "turnScopeId",
    "thinkingStartedAt",
    "thinkingFinishedAt",
  ]) {
    if (message?.[key] !== undefined) summary[key] = message[key];
  }
  return compactMessageSummary(summary);
}

function truncateText(value = "", maxLength = LENGTH_THRESHOLDS.display.sessionSummaryTextChars) {
  const text = typeof value === "string" ? value : JSON.stringify(value ?? "");
  return text.length > maxLength ? `${text.slice(0, maxLength)}…` : text;
}

function pickPlainObjectFields(source = null, keys = []) {
  if (!source || typeof source !== "object" || Array.isArray(source)) return null;
  const out = {};
  for (const key of keys) {
    const value = source?.[key];
    if (value === undefined || value === null || value === "") continue;
    if (["string", "number", "boolean"].includes(typeof value)) out[key] = value;
  }
  return Object.keys(out).length ? out : null;
}

function pickLightAttachments(message = {}) {
  const metas = Array.isArray(message?.attachments) ? message.attachments : [];
  return dedupeAttachmentRefs([
    ...metas.map((item) => compactAttachmentRef(item)).filter(Boolean),
    ...collectAttachmentRefsFromTransferEnvelopes(message?.transferEnvelopes),
  ]);
}

function pickLightObject(source = {}, allowedKeys = []) {
  if (!source || typeof source !== "object" || Array.isArray(source)) return null;
  const picked = {};
  for (const key of allowedKeys) {
    const value = source?.[key];
    if (value === undefined || value === null || value === "") continue;
    if (["string", "number", "boolean"].includes(typeof value)) {
      picked[key] = value;
    } else if (Array.isArray(value)) {
      picked[key] = value
        .slice(0, 20)
        .map((item) =>
          ["string", "number", "boolean"].includes(typeof item)
            ? item
            : truncateText(item, SUMMARY_ARRAY_ITEM_CHARS),
        );
    } else if (typeof value === "object") {
      picked[key] = truncateText(value, SUMMARY_OBJECT_FIELD_CHARS);
    }
  }
  return Object.keys(picked).length ? picked : null;
}

function clonePlainJson(value, { maxStringLength = SUMMARY_DEFAULT_JSON_STRING_CHARS } = {}) {
  if (value === undefined || value === null) return value;
  if (["number", "boolean"].includes(typeof value)) return value;
  if (typeof value === "string") return truncateText(value, maxStringLength);
  if (Array.isArray(value)) return value.map((item) => clonePlainJson(item, { maxStringLength }));
  if (typeof value !== "object") return undefined;
  const cloned = {};
  for (const [key, itemValue] of Object.entries(value)) {
    const nextValue = clonePlainJson(itemValue, { maxStringLength });
    if (nextValue !== undefined) cloned[key] = nextValue;
  }
  return cloned;
}

function pickPlainFields(source = {}, allowedKeys = [], options = {}) {
  if (!source || typeof source !== "object" || Array.isArray(source)) return null;
  const picked = {};
  for (const key of allowedKeys) {
    if (source?.[key] === undefined || source?.[key] === null || source?.[key] === "") continue;
    const value = clonePlainJson(source[key], options);
    if (value !== undefined) picked[key] = value;
  }
  return Object.keys(picked).length ? picked : null;
}

function pickTransferEnvelope(envelope = {}) {
  return compactTransferEnvelopes([envelope])[0] || null;
}

function pickLightPayloadTransferEnvelopes(value = []) {
  return (Array.isArray(value) ? value : [])
    .filter((item) => item && typeof item === "object" && !Array.isArray(item))
    .slice(0, 50)
    .map((item) => pickTransferEnvelope(item))
    .filter(Boolean);
}

function pickPayloadStepFailure(value) {
  if (!value) return null;
  if (typeof value === "string") return truncateText(value, SUMMARY_OBJECT_FIELD_CHARS);
  if (typeof value !== "object" || Array.isArray(value)) return null;
  return pickPlainFields(value, ["message", "error", "code", "name", "stack"], {
    maxStringLength: SUMMARY_OBJECT_FIELD_CHARS,
  });
}

function pickPayloadSemantic(semantic = {}) {
  if (!semantic || typeof semantic !== "object" || Array.isArray(semantic)) return null;
  return pickPlainFields(semantic, ["nodes", "flowtos", "edges", "attachments"], {
    maxStringLength: SUMMARY_DEFAULT_JSON_STRING_CHARS,
  });
}

function pickPayloadNodeRun(item = {}) {
  if (!item || typeof item !== "object" || Array.isArray(item)) return null;
  const picked = pickPlainFields(item, [
    "transition", "stepId", "stepIndex", "actionNodeStateId", "nodeDialogProcessId", "dialogProcessId",
    "nodeDialogId", "dialogId",
    "nodeSessionId", "sessionId", "rootSessionId", "stepStatus", "status", "parallelWave", "waveOrder",
  ], { maxStringLength: SUMMARY_OBJECT_FIELD_CHARS }) || {};
  const step = pickPlainFields(item?.step, [
    "nodeId", "nodeName", "nodeType", "type", "stateType", "stepId", "stepIndex", "actionNodeStateId",
  ], { maxStringLength: SUMMARY_OBJECT_FIELD_CHARS });
  if (step) picked.step = step;
  const stepFailure = pickPayloadStepFailure(item?.stepFailure);
  if (stepFailure) picked.stepFailure = stepFailure;
  const envelopes = pickLightPayloadTransferEnvelopes(item?.nodeResultTransferEnvelopes || item?.transferEnvelopes);
  if (envelopes.length) picked.nodeResultTransferEnvelopes = envelopes;
  return Object.keys(picked).length ? picked : null;
}

function pickPayloadNodeSession(item = {}) {
  if (!item || typeof item !== "object" || Array.isArray(item)) return null;
  const picked = pickPlainFields(item, [
    "transition", "nodeName", "nodeId", "nodeType", "actionNodeStateId", "stepId", "stepIndex",
    "type", "stateType", "rootSessionId", "dialogProcessId", "dialogId", "sessionId", "stepStatus", "status",
    "parallelWave", "waveOrder",
  ], { maxStringLength: SUMMARY_OBJECT_FIELD_CHARS }) || {};
  const stepFailure = pickPayloadStepFailure(item?.stepFailure);
  if (stepFailure) picked.stepFailure = stepFailure;
  const envelopes = pickLightPayloadTransferEnvelopes(item?.transferEnvelopes || item?.nodeResultTransferEnvelopes);
  if (envelopes.length) picked.transferEnvelopes = envelopes;
  return Object.keys(picked).length ? picked : null;
}

function pickPluginPayloadSnapshot(payload = {}) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return null;
  const picked = pickPlainFields(payload, ["workflowRunId", "status", "phase", "phaseStatus"], {
    maxStringLength: SUMMARY_SMALL_JSON_STRING_CHARS,
  }) || {};
  const semantic = pickPayloadSemantic(payload?.semantic);
  if (semantic) picked.semantic = semantic;
  if (payload?.execution && typeof payload.execution === "object" && !Array.isArray(payload.execution)) {
    const execution = pickPlainFields(
      payload.execution,
      ["workflowRunId", "instanceId", "completed", "status", "startedAt", "endedAt", "error"],
      { maxStringLength: SUMMARY_OBJECT_FIELD_CHARS },
    ) || {};
    const runs = (Array.isArray(payload.execution?.nodeAgentRuns) ? payload.execution.nodeAgentRuns : [])
      .slice(0, 100)
      .map((item) => pickPayloadNodeRun(item))
      .filter(Boolean);
    if (runs.length) execution.nodeAgentRuns = runs;
    if (Object.keys(execution).length) picked.execution = execution;
  }
  const nodeSessions = (Array.isArray(payload?.nodeSessions) ? payload.nodeSessions : [])
    .slice(0, 100)
    .map((item) => pickPayloadNodeSession(item))
    .filter(Boolean);
  if (nodeSessions.length) picked.nodeSessions = nodeSessions;
  const planningDialog = pickPlainFields(
    payload?.planningDialog,
    ["sessionId", "dialogProcessId", "dialogId", "parentSessionId"],
    { maxStringLength: SUMMARY_OBJECT_FIELD_CHARS },
  );
  if (planningDialog) picked.planningDialog = planningDialog;
  const runMeta = pickPlainFields(
    payload?.runMeta,
    ["sessionId", "dialogProcessId", "dialogId", "parentSessionId", "runId"],
    { maxStringLength: SUMMARY_OBJECT_FIELD_CHARS },
  );
  if (runMeta) picked.runMeta = runMeta;
  const interaction = pickPlainFields(payload?.interaction, ["semanticTextPreview"], {
    maxStringLength: LENGTH_THRESHOLDS.display.sessionSummaryTextChars,
  });
  if (interaction) picked.interaction = interaction;
  return Object.keys(picked).length ? picked : null;
}

function hasPluginPayloadSnapshot(message = {}) {
  const payload = message?.pluginMeta?.payload;
  return Boolean(payload && typeof payload === "object" && !Array.isArray(payload));
}

function pickLightPluginMeta(message = {}) {
  const pluginMeta = pickLightObject(message?.pluginMeta, [
    "pluginId", "pluginName", "pluginKey", "name", "title", "status", "state", "icon", "color",
    "source", "kind", "phase", "nodeId", "nodeName", "nodeType", "stepId", "stepName",
  ]);
  if (pluginMeta && hasPluginPayloadSnapshot(message)) {
    const payload = pickPluginPayloadSnapshot(message?.pluginMeta?.payload);
    if (payload) pluginMeta.payload = payload;
  }
  return pluginMeta;
}

function pickLightTransferEnvelopes(message = {}) {
  const seen = new Set();
  return (Array.isArray(message?.transferEnvelopes) ? message.transferEnvelopes : [])
    .filter((item) => item && typeof item === "object" && !Array.isArray(item))
    .map((envelope) => pickTransferEnvelope(envelope))
    .filter(Boolean)
    .filter((item) => {
      const key = JSON.stringify(item);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
}

function buildThinkingDetailCountByMessage(messages = []) {
  const routeByMessage = new WeakMap();
  const factsByRoute = new Map();
  messages.forEach((message, index) => {
    if (!message || typeof message !== "object" || Array.isArray(message)) return;
    const turnScopeId = String(message?.turnScopeId || "").trim();
    const dialogProcessId = String(message?.dialogProcessId || "").trim();
    const route = turnScopeId
      ? `turn:${turnScopeId}`
      : dialogProcessId
        ? `dialog:${dialogProcessId}`
        : `message:${index}`;
    routeByMessage.set(message, route);
    const facts = factsByRoute.get(route) || {
      activityKeys: new Set(),
      toolKeys: new Set(),
      unkeyedActivityCount: 0,
      unkeyedToolCount: 0,
    };
    for (const item of Array.isArray(message?.activityTimeline) ? message.activityTimeline : []) {
      if (!item || typeof item !== "object" || Array.isArray(item)) continue;
      const key = String(item?.eventId || item?.id || "").trim();
      if (key) facts.activityKeys.add(key);
      else facts.unkeyedActivityCount += 1;
    }
    for (const item of Array.isArray(message?.toolTimeline) ? message.toolTimeline : []) {
      if (!item || typeof item !== "object" || Array.isArray(item)) continue;
      const key = String(item?.key || item?.toolCallId || item?.tool_call_id || "").trim();
      if (key) facts.toolKeys.add(key);
      else facts.unkeyedToolCount += 1;
    }
    factsByRoute.set(route, facts);
  });
  return (message = {}) => {
    const facts = factsByRoute.get(routeByMessage.get(message));
    if (!facts) return 0;
    return facts.activityKeys.size + facts.toolKeys.size
      + facts.unkeyedActivityCount + facts.unkeyedToolCount;
  };
}

function buildDisplayMessageSummary(message = {}) {
  if (!message || typeof message !== "object" || Array.isArray(message)) return null;
  const role = String(message?.role || "").trim();
  if (!role || message?.injectedMessage === true) return null;
  const type = String(message?.type || "").trim();
  if (!["user", "assistant"].includes(role)) return null;
  const hasCanonicalActivity =
    role === "assistant" &&
    String(message?.presentationMessageId || "").trim() &&
    Array.isArray(message?.activityTimeline) &&
    message.activityTimeline.length > 0;
  if (role === "assistant" && message?.chatPresentation === false && !hasCanonicalActivity) return null;
  if (["tool_call", "tool_result"].includes(type) && !hasCanonicalActivity) return null;
  const presentationMessageId = String(message?.presentationMessageId || "").trim();
  if (role === "assistant" && (message?.chatPresentation === true || hasCanonicalActivity) && !presentationMessageId) return null;
  const summary = buildMessageSummary(message) || {};
  summary.content = typeof message?.content === "string" ? message.content : JSON.stringify(message?.content ?? "");
  if (hasCanonicalActivity && message?.chatPresentation !== true) {
    summary.type = "message";
    summary.chatPresentation = true;
    summary.sourceMessageType = type;
  }
  const messageUid = String(message?.messageUid || "").trim();
  const sourceMessageId = String(message?.messageId || message?.id || "").trim();
  const messageId = String(presentationMessageId || sourceMessageId || messageUid).trim();
  if (messageId) {
    summary.id = messageId;
    summary.messageId = messageId;
  }
  if (presentationMessageId) {
    if (sourceMessageId && presentationMessageId !== sourceMessageId) {
      summary.sourceMessageId = sourceMessageId;
    }
    if (messageUid) summary.sourceMessageUid = messageUid;
  } else if (messageUid) {
    summary.messageUid = messageUid;
  }
  const attachments = pickLightAttachments(message);
  if (attachments.length) summary.attachments = attachments;
  for (const key of ["pluginMessage", "done", "pending", "error"]) {
    if (message?.[key] !== undefined) summary[key] = message[key];
  }
  const pluginMeta = pickLightPluginMeta(message);
  const transferEnvelopes = pickLightTransferEnvelopes(message);
  if (pluginMeta) summary.pluginMeta = pluginMeta;
  if (transferEnvelopes.length) summary.transferEnvelopes = transferEnvelopes;
  if (Array.isArray(message?.tool_calls) && message.tool_calls.length) {
    summary.toolCalls = message.tool_calls.map((toolCall = {}) => ({
      id: String(toolCall?.id || "").trim(),
      name: String(toolCall?.function?.name || toolCall?.name || "").trim(),
    })).filter((item) => item.id || item.name);
  }
  return compactMessageSummary(summary);
}

function buildActiveTurnPresentation(lifecycle = null, sessionId = "") {
  const activeTurnScopeId = String(lifecycle?.activeTurnScopeId || "").trim();
  if (!activeTurnScopeId) return null;
  const activeTurn = lifecycle?.turns?.[activeTurnScopeId];
  if (!activeTurn || typeof activeTurn !== "object" || Array.isArray(activeTurn)) {
    throw new TypeError("active Turn presentation invariant failed: turn_missing");
  }
  if (String(activeTurn.turnScopeId || "").trim() !== activeTurnScopeId) {
    throw new TypeError("active Turn presentation invariant failed: turn_scope_mismatch");
  }
  const presentationMessageId = String(activeTurn.presentationMessageId || "").trim();
  if (!presentationMessageId) {
    throw new TypeError("active Turn presentation invariant failed: presentation_message_id_missing");
  }
  return {
    id: presentationMessageId,
    messageId: presentationMessageId,
    presentationMessageId,
    role: "assistant",
    type: "message",
    content: "",
    sessionId,
    turnScopeId: activeTurnScopeId,
    dialogProcessId: String(activeTurn.dialogProcessId || "").trim(),
    chatPresentation: true,
    turnPlaceholder: true,
    ts: String(activeTurn.updatedAt || activeTurn.startedAt || activeTurn.createdAt || "").trim(),
  };
}

function buildToolLogSummaries(session = {}) {
  const messages = Array.isArray(session?.messages) ? session.messages : [];
  const sessionId = String(session?.sessionId || "").trim();
  const toolNameByCallId = new Map();
  const canonicalArtifactsByCallId = new Map();
  const logs = [];
  let totalCount = 0;
  for (const message of messages) {
    const role = String(message?.role || "").trim();
    const type = String(message?.type || "").trim();
    const ts = String(message?.ts || "").trim();
    const dialogProcessId = String(message?.dialogProcessId || "").trim();
    const parentDialogProcessId = String(message?.parentDialogProcessId || "").trim();
    const turnScopeId = String(message?.turnScopeId || "").trim();
    for (const item of Array.isArray(message?.toolTimeline) ? message.toolTimeline : []) {
      const toolCallId = String(item?.toolCallId || "").trim();
      const resultEvent = item?.resultEvent && typeof item.resultEvent === "object"
        ? item.resultEvent
        : {};
      const eventLog = resultEvent?.log && typeof resultEvent.log === "object"
        ? resultEvent.log
        : {};
      const attachments = pickLightAttachments({
        attachments: Array.isArray(resultEvent?.attachments)
          ? resultEvent.attachments
          : eventLog.attachments,
      });
      const writtenFiles = (Array.isArray(resultEvent?.writtenFiles)
        ? resultEvent.writtenFiles
        : Array.isArray(eventLog?.writtenFiles)
          ? eventLog.writtenFiles
          : [])
        .map((fileItem = {}) => pickLightObject(fileItem, [
          "toolName", "resolvedPath", "relativePath", "fileName", "isSandbox",
          "size", "mimeType", "sourceType", "recognized",
        ]))
        .filter(Boolean);
      if (toolCallId && (attachments.length || writtenFiles.length)) {
        canonicalArtifactsByCallId.set(toolCallId, { attachments, writtenFiles });
      }
    }
    if (type === "tool_call" || (role === "assistant" && Array.isArray(message?.tool_calls))) {
      for (const toolCall of Array.isArray(message?.tool_calls) ? message.tool_calls : []) {
        const toolCallId = String(toolCall?.id || "").trim();
        const toolName = String(toolCall?.function?.name || toolCall?.name || "unknown_tool").trim();
        if (toolCallId) toolNameByCallId.set(toolCallId, toolName);
        totalCount += 1;
      }
    }
    if (role === "tool" || type === "tool_result") {
      const toolCallId = String(message?.tool_call_id || "").trim();
      const toolName = toolNameByCallId.get(toolCallId) || String(message?.toolName || "tool_result");
      totalCount += 1;
      const canonicalArtifacts = canonicalArtifactsByCallId.get(toolCallId) || {};
      const attachments = dedupeAttachmentRefs([
        ...pickLightAttachments(message),
        ...(Array.isArray(canonicalArtifacts.attachments) ? canonicalArtifacts.attachments : []),
      ]);
      const writtenFiles = Array.isArray(canonicalArtifacts.writtenFiles)
        ? canonicalArtifacts.writtenFiles
        : [];
      if (!attachments.length && !writtenFiles.length) continue;
      const summary = {
        event: "tool_result", type: "tool_result",
        role: "tool",
        toolName,
        text: writtenFiles.length
          ? `${writtenFiles[0]?.toolName || toolName} ${writtenFiles[0]?.fileName || ""}`.trim()
          : truncateText(`${toolName}`.trim(), SUMMARY_FILE_NAME_CHARS),
        ts, sessionId, toolCallId, dialogProcessId, parentDialogProcessId, turnScopeId,
      };
      if (attachments.length) summary.attachments = attachments;
      if (writtenFiles.length) summary.writtenFiles = writtenFiles;
      logs.push(summary);
    }
  }
  return { logs, totalCount };
}

export function buildSessionDisplaySummary(session = {}) {
  const messages = Array.isArray(session?.messages) ? session.messages : [];
  const terminalTurnScopeIds = [...new Set(
    messages.map((message) => String(message?.turnScopeId || "").trim()).filter(Boolean),
  )];
  const turnTimings = Array.isArray(session?.turnTimings) ? session.turnTimings : [];
  const turnStatuses = Array.isArray(session?.turnStatuses) ? session.turnStatuses : [];
  const sessionId = String(session?.sessionId || "").trim();
  const lifecycle = session?.turnLifecycle && typeof session.turnLifecycle === "object"
    ? session.turnLifecycle
    : null;
  const lifecycleTurns = lifecycle?.turns && typeof lifecycle.turns === "object"
    ? lifecycle.turns
    : {};
  const firstUserMessage = messages.find(
    (messageItem) =>
      messageItem?.injectedMessage !== true &&
      String(messageItem?.role || "").trim().toLowerCase() === "user" &&
      String(messageItem?.content || "").trim(),
  );
  const customTitle = String(session?.customTitle || "").trim();
  const thinkingDetailCountForMessage = buildThinkingDetailCountByMessage(messages);
  const projectedDisplayMessages = messages
    .map((message) => {
      const summary = buildDisplayMessageSummary(message);
      if (!summary || String(message?.role || "").trim() !== "assistant") return summary;
      const thinkingDetailCount = thinkingDetailCountForMessage(message);
      if (thinkingDetailCount > 0) {
        summary.thinkingDetailCount = thinkingDetailCount;
        summary.hasThinkingDetails = true;
      } else {
        delete summary.thinkingDetailCount;
        delete summary.hasThinkingDetails;
      }
      return summary;
    })
    .filter(Boolean);
  const activeTurnPresentation = buildActiveTurnPresentation(lifecycle, sessionId);
  if (activeTurnPresentation) {
    const presentationMessageId = activeTurnPresentation.presentationMessageId;
    const existingPresentation = projectedDisplayMessages.find((message) => (
      String(message?.presentationMessageId || message?.messageId || message?.id || "").trim() ===
      presentationMessageId
    ));
    if (existingPresentation && String(existingPresentation?.role || "").trim() !== "assistant") {
      throw new TypeError("active Turn presentation invariant failed: presentation_role_conflict");
    }
    if (
      existingPresentation &&
      String(existingPresentation?.turnScopeId || "").trim() !== activeTurnPresentation.turnScopeId
    ) {
      throw new TypeError("active Turn presentation invariant failed: presentation_turn_scope_conflict");
    }
    if (!existingPresentation) {
      const owningUserIndex = projectedDisplayMessages.findLastIndex((message) => (
        String(message?.role || "").trim() === "user" &&
        String(message?.turnScopeId || "").trim() === activeTurnPresentation.turnScopeId
      ));
      projectedDisplayMessages.splice(
        owningUserIndex >= 0 ? owningUserIndex + 1 : projectedDisplayMessages.length,
        0,
        activeTurnPresentation,
      );
    }
  }
  const displayMessageByIdentity = new Map();
  for (const message of projectedDisplayMessages) {
    const identity = String(message?.presentationMessageId || message?.messageId || message?.id || "").trim();
    if (!identity || message?.role !== "assistant") {
      displayMessageByIdentity.set(`${identity}:${displayMessageByIdentity.size}`, message);
      continue;
    }
    const existing = displayMessageByIdentity.get(identity);
    if (!existing) {
      displayMessageByIdentity.set(identity, message);
      continue;
    }
    const existingIsPlaceholder = Boolean(String(existing?.sourceMessageType || "").trim());
    const incomingIsPlaceholder = Boolean(String(message?.sourceMessageType || "").trim());
    const presentation = !incomingIsPlaceholder || existingIsPlaceholder ? message : existing;
    presentation.thinkingDetailCount = Math.max(
      Number(existing?.thinkingDetailCount || 0),
      Number(message?.thinkingDetailCount || 0),
    );
    presentation.hasThinkingDetails = presentation.thinkingDetailCount > 0;
    displayMessageByIdentity.set(identity, presentation);
  }
  const displayMessages = [...displayMessageByIdentity.values()];
  const injectedCount = messages.filter((message) => message?.injectedMessage === true).length;
  const thinkingCount = displayMessages.filter((message) => message?.hasThinkingDetails === true).length;
  const { logs: toolLogSummaries, totalCount: toolLogCount } = buildToolLogSummaries(session);
  const attachmentCount = displayMessages.reduce(
    (count, message) => count + (Array.isArray(message?.attachments) ? message.attachments.length : 0),
    0,
  );
  const turnLifecycleSnapshot = lifecycle
    ? createAuthoritativeTurnSnapshot({
      lifecycle,
      turnTimings,
      terminalTurnScopeIds,
      commandId: `session-summary:${sessionId}:${Number(lifecycle?.sequence || 0)}`,
      sessionId,
      generatedAt: String(session?.updatedAt || "").trim(),
    })
    : null;
  return {
    schemaVersion: SESSION_DISPLAY_SUMMARY_SCHEMA_VERSION,
    sessionId,
    parentSessionId: String(session?.parentSessionId || "").trim(),
    caller: String(session?.caller || "user").trim() || "user",
    currentTaskId: String(session?.currentTaskId || "").trim(),
    createdAt: String(session?.createdAt || "").trim(),
    updatedAt: String(session?.updatedAt || "").trim(),
    title: customTitle || (firstUserMessage
      ? String(firstUserMessage.content || "").slice(0, 20)
      : sessionId.slice(0, 8)),
    version: session?.version,
    revision: session?.revision,
    turnTimings,
    turnStatuses,
    turnLifecycleSnapshot,
    messages: displayMessages,
    toolLogSummaries,
    stats: {
      messageCount: messages.length,
      displayMessageCount: displayMessages.length,
      injectedMessageCount: injectedCount,
      thinkingMessageCount: thinkingCount,
      toolLogCount,
      displayToolLogCount: toolLogSummaries.length,
      hasToolDetails: toolLogCount > 0,
      attachmentCount,
    },
  };
}

export function normalizeSessionsSummaryPayload(payload = {}, now = () => new Date().toISOString()) {
  const source = Array.isArray(payload?.sessions) ? payload.sessions : [];
  const sessions = source
    .filter((item) => item && typeof item === "object" && !Array.isArray(item))
    .map((item) => ({
      sessionId: String(item?.sessionId || "").trim(),
      parentSessionId: String(item?.parentSessionId || "").trim(),
      caller: String(item?.caller || "user").trim() || "user",
      currentTaskId: String(item?.currentTaskId || "").trim(),
      createdAt: String(item?.createdAt || "").trim(),
      updatedAt: String(item?.updatedAt || "").trim(),
      depth: Number.isFinite(Number(item?.depth)) ? Number(item.depth) : 0,
      title: String(item?.title || "").trim() || String(item?.sessionId || "").trim().slice(0, 8),
      messageCount: Number.isFinite(Number(item?.messageCount)) ? Number(item.messageCount) : 0,
      lastMessage:
        item?.lastMessage && typeof item.lastMessage === "object" && !Array.isArray(item.lastMessage)
          ? item.lastMessage
          : null,
    }))
    .filter((item) => item.sessionId);
  return {
    sessions,
    updatedAt: String(payload?.updatedAt || "").trim() || now(),
  };
}
