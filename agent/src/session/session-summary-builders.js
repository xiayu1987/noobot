/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

import { LENGTH_THRESHOLDS } from "@noobot/shared/length-thresholds";
import { createAuthoritativeTurnSnapshot } from "@noobot/authoritative-state/application";
import { projectToolOperationSummary } from "@noobot/event-protocol/tool-presentation";
import {
  collectAttachmentRefsFromTransferEnvelopes,
  compactAttachmentRef,
  compactTransferEnvelopes,
  dedupeAttachmentRefs,
  compactSessionAttachmentRef,
  dedupeSessionAttachmentRefs,
} from "./transfer-attachment-refs.js";
import { projectThinkingTimeline } from "./thinking-timeline-projection.js";

export const SESSION_DISPLAY_SUMMARY_SCHEMA_VERSION = 22;
export const SESSIONS_SUMMARY_SCHEMA_VERSION = 2;
export const SESSION_DETAIL_MESSAGE_PROJECTION = "canonical-presentation";
const REQUIRED_MESSAGE_SUMMARY_KEYS = new Set(["turnScopeId"]);
const SUMMARY_ARRAY_ITEM_CHARS = LENGTH_THRESHOLDS.display.sessionSummaryArrayItemChars;
const SUMMARY_OBJECT_FIELD_CHARS = LENGTH_THRESHOLDS.display.sessionSummaryObjectFieldChars;
const SUMMARY_DEFAULT_JSON_STRING_CHARS =
  LENGTH_THRESHOLDS.display.sessionSummaryDefaultJsonStringChars;
const SUMMARY_SMALL_JSON_STRING_CHARS =
  LENGTH_THRESHOLDS.display.sessionSummarySmallJsonStringChars;

function compactThinkingTimeline(items = []) {
  const compactFact = (fact = {}, summary = "") => ({
    eventId: String(fact.eventId || "").trim(),
    sequence: fact.sequence,
    ...(String(fact.sequenceScopeId || "").trim()
      ? { sequenceScopeId: String(fact.sequenceScopeId).trim() }
      : {}),
    ...(String(fact.authority || "").trim() ? { authority: String(fact.authority).trim() } : {}),
    ...(String(fact.sequenceDomain || "").trim()
      ? { sequenceDomain: String(fact.sequenceDomain).trim() }
      : {}),
    ...(String(fact.sessionId || "").trim() ? { sessionId: String(fact.sessionId).trim() } : {}),
    ...(String(fact.dialogProcessId || "").trim()
      ? { dialogProcessId: String(fact.dialogProcessId).trim() }
      : {}),
    ...(String(fact.turnScopeId || "").trim()
      ? { turnScopeId: String(fact.turnScopeId).trim() }
      : {}),
    ...(Array.isArray(fact.attachments) && fact.attachments.length
      ? { attachments: fact.attachments }
      : {}),
    ...(summary ? { summary } : {}),
  });
  return (Array.isArray(items) ? items : []).map((item = {}) => ({
    key: String(item.key || item.toolCallId || item.tool_call_id || "").trim(),
    toolCallId: String(item.toolCallId || item.tool_call_id || "").trim(),
    tool: String(item.tool || "").trim(),
    status: String(item.status || "").trim(),
    ...(String(item.riskLevel || "").trim() ? { riskLevel: String(item.riskLevel).trim() } : {}),
    ...(item.call
      ? {
          call: compactFact(
            item.call,
            projectToolOperationSummary(item.tool, item.args, { result: false }),
          ),
        }
      : {}),
    ...(item.resultEvent
      ? {
          resultEvent: compactFact(
            item.resultEvent,
            projectToolOperationSummary(item.tool, item.result, { result: true }),
          ),
        }
      : {}),
  }));
}

export function isSessionDisplaySummaryPayload(payload = null, sessionId = "") {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return false;
  if (Number(payload?.schemaVersion || 0) !== SESSION_DISPLAY_SUMMARY_SCHEMA_VERSION) return false;
  const normalizedSessionId = String(sessionId || "").trim();
  if (normalizedSessionId && String(payload?.sessionId || "").trim() !== normalizedSessionId)
    return false;
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
      String(messageItem?.role || "")
        .trim()
        .toLowerCase() === "user" &&
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
    aggregateVersion: Math.max(0, Number(session?.aggregateVersion) || 0),
    title:
      customTitle ||
      (firstUserMessage
        ? String(firstUserMessage.content || "").slice(0, 20)
        : sessionId.slice(0, 8)),
    messageCount: messages.length,
    lastMessage,
    availability: "available",
  };
}

export function buildUnavailableSessionSummary({
  sessionId = "",
  parentSessionId = "",
  title = "",
  caller = "user",
  createdAt = "",
  updatedAt = "",
  errorCode = "SESSION_PROTOCOL_INVALID",
  reason = "",
  depth = 0,
} = {}) {
  const normalizedSessionId = String(sessionId || "").trim();
  return {
    sessionId: normalizedSessionId,
    parentSessionId: String(parentSessionId || "").trim(),
    caller: String(caller || "user").trim() || "user",
    currentTaskId: "",
    createdAt: String(createdAt || "").trim(),
    updatedAt: String(updatedAt || "").trim(),
    depth: Number.isFinite(Number(depth)) ? Number(depth) : 0,
    aggregateVersion: 0,
    title: String(title || "").trim() || normalizedSessionId.slice(0, 8),
    messages: [],
    messageCount: 0,
    lastMessage: null,
    availability: "unavailable",
    unavailableReason: {
      code: String(errorCode || "SESSION_PROTOCOL_INVALID").trim() || "SESSION_PROTOCOL_INVALID",
      message: String(reason || "Session uses an unsupported protocol").trim(),
    },
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
    "noobotInternalMessageType",
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
  return dedupeSessionAttachmentRefs(metas.map(compactSessionAttachmentRef).filter(Boolean));
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
  const picked =
    pickPlainFields(
      item,
      [
        "transition",
        "stepId",
        "stepIndex",
        "actionNodeStateId",
        "nodeDialogProcessId",
        "dialogProcessId",
        "nodeDialogId",
        "dialogId",
        "nodeSessionId",
        "sessionId",
        "rootSessionId",
        "stepStatus",
        "status",
        "parallelWave",
        "waveOrder",
      ],
      { maxStringLength: SUMMARY_OBJECT_FIELD_CHARS },
    ) || {};
  const step = pickPlainFields(
    item?.step,
    [
      "nodeId",
      "nodeName",
      "nodeType",
      "type",
      "stateType",
      "stepId",
      "stepIndex",
      "actionNodeStateId",
    ],
    { maxStringLength: SUMMARY_OBJECT_FIELD_CHARS },
  );
  if (step) picked.step = step;
  const stepFailure = pickPayloadStepFailure(item?.stepFailure);
  if (stepFailure) picked.stepFailure = stepFailure;
  const envelopes = pickLightPayloadTransferEnvelopes(
    item?.nodeResultTransferEnvelopes || item?.transferEnvelopes,
  );
  if (envelopes.length) picked.nodeResultTransferEnvelopes = envelopes;
  return Object.keys(picked).length ? picked : null;
}

function pickPayloadNodeSession(item = {}) {
  if (!item || typeof item !== "object" || Array.isArray(item)) return null;
  const picked =
    pickPlainFields(
      item,
      [
        "transition",
        "nodeName",
        "nodeId",
        "nodeType",
        "actionNodeStateId",
        "stepId",
        "stepIndex",
        "type",
        "stateType",
        "rootSessionId",
        "dialogProcessId",
        "dialogId",
        "sessionId",
        "stepStatus",
        "status",
        "parallelWave",
        "waveOrder",
      ],
      { maxStringLength: SUMMARY_OBJECT_FIELD_CHARS },
    ) || {};
  const stepFailure = pickPayloadStepFailure(item?.stepFailure);
  if (stepFailure) picked.stepFailure = stepFailure;
  const envelopes = pickLightPayloadTransferEnvelopes(
    item?.transferEnvelopes || item?.nodeResultTransferEnvelopes,
  );
  if (envelopes.length) picked.transferEnvelopes = envelopes;
  return Object.keys(picked).length ? picked : null;
}

function pickPluginPayloadSnapshot(payload = {}) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return null;
  const picked =
    pickPlainFields(payload, ["workflowRunId", "status", "phase", "phaseStatus"], {
      maxStringLength: SUMMARY_SMALL_JSON_STRING_CHARS,
    }) || {};
  const semantic = pickPayloadSemantic(payload?.semantic);
  if (semantic) picked.semantic = semantic;
  if (
    payload?.execution &&
    typeof payload.execution === "object" &&
    !Array.isArray(payload.execution)
  ) {
    const execution =
      pickPlainFields(
        payload.execution,
        ["workflowRunId", "instanceId", "completed", "status", "startedAt", "endedAt", "error"],
        { maxStringLength: SUMMARY_OBJECT_FIELD_CHARS },
      ) || {};
    const runs = (
      Array.isArray(payload.execution?.nodeAgentRuns) ? payload.execution.nodeAgentRuns : []
    )
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
    "pluginId",
    "pluginName",
    "name",
    "title",
    "status",
    "state",
    "icon",
    "color",
    "source",
    "kind",
    "phase",
    "nodeId",
    "nodeName",
    "nodeType",
    "stepId",
    "stepName",
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
    return (
      facts.activityKeys.size +
      facts.toolKeys.size +
      facts.unkeyedActivityCount +
      facts.unkeyedToolCount
    );
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
  if (role === "assistant" && message?.chatPresentation === false && !hasCanonicalActivity)
    return null;
  if (["tool_call", "tool_result"].includes(type) && !hasCanonicalActivity) return null;
  const presentationMessageId = String(message?.presentationMessageId || "").trim();
  if (
    role === "assistant" &&
    (message?.chatPresentation === true || hasCanonicalActivity) &&
    !presentationMessageId
  )
    return null;
  const summary = buildMessageSummary(message) || {};
  summary.content =
    typeof message?.content === "string" ? message.content : JSON.stringify(message?.content ?? "");
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
    summary.toolCalls = message.tool_calls
      .map((toolCall = {}) => ({
        id: String(toolCall?.id || "").trim(),
        name: String(toolCall?.function?.name || toolCall?.name || "").trim(),
      }))
      .filter((item) => item.id || item.name);
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
    throw new TypeError(
      "active Turn presentation invariant failed: presentation_message_id_missing",
    );
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

function buildToolArtifactTimelineProjection(session = {}) {
  const messages = Array.isArray(session?.messages) ? session.messages : [];
  const sessionId = String(session?.sessionId || "").trim();
  const toolNameByCallId = new Map();
  const artifactByCallId = new Map();
  let totalCount = 0;
  const routeKeyOf = (message = {}) => {
    const turnScopeId = String(message?.turnScopeId || "").trim();
    return sessionId && turnScopeId ? `${sessionId}::${turnScopeId}` : "";
  };
  const callKeyOf = (message = {}, toolCallId = "") => {
    const routeKey = routeKeyOf(message);
    const normalizedToolCallId = String(toolCallId || "").trim();
    return routeKey && normalizedToolCallId ? `${routeKey}::${normalizedToolCallId}` : "";
  };
  for (const message of messages) {
    const role = String(message?.role || "").trim();
    const type = String(message?.type || "").trim();
    const ts = String(message?.ts || "").trim();
    const dialogProcessId = String(message?.dialogProcessId || "").trim();
    const parentDialogProcessId = String(message?.parentDialogProcessId || "").trim();
    const turnScopeId = String(message?.turnScopeId || "").trim();
    for (const item of Array.isArray(message?.toolTimeline) ? message.toolTimeline : []) {
      const toolCallId = String(item?.toolCallId || "").trim();
      const callKey = callKeyOf(message, toolCallId);
      if (!callKey) continue;
      const resultEvent =
        item?.resultEvent && typeof item.resultEvent === "object" ? item.resultEvent : {};
      const attachments = collectAttachmentRefsFromTransferEnvelopes(
        resultEvent?.transferEnvelopes,
      );
      if (attachments.length) {
        artifactByCallId.set(callKey, {
          toolCallId,
          toolName: String(item?.tool || "").trim(),
          eventId: String(resultEvent?.eventId || "").trim(),
          sequence: Number(resultEvent?.sequence || 0),
          sequenceScopeId: String(resultEvent?.sequenceScopeId || "").trim(),
          authority: String(resultEvent?.authority || "").trim(),
          sequenceDomain: String(resultEvent?.sequenceDomain || "").trim(),
          ts: String(resultEvent?.timestamp || resultEvent?.timelineTimestamp || ts).trim(),
          sessionId,
          dialogProcessId,
          parentDialogProcessId,
          turnScopeId,
          attachments,
        });
      }
    }
    if (type === "tool_call" || (role === "assistant" && Array.isArray(message?.tool_calls))) {
      for (const toolCall of Array.isArray(message?.tool_calls) ? message.tool_calls : []) {
        const toolCallId = String(toolCall?.id || "").trim();
        const toolName = String(
          toolCall?.function?.name || toolCall?.name || "unknown_tool",
        ).trim();
        const callKey = callKeyOf(message, toolCallId);
        if (callKey) toolNameByCallId.set(callKey, toolName);
        totalCount += 1;
      }
    }
    if (role === "tool" || type === "tool_result") {
      const toolCallId = String(message?.tool_call_id || "").trim();
      const callKey = callKeyOf(message, toolCallId);
      const canonicalArtifact = callKey ? artifactByCallId.get(callKey) : null;
      const toolName =
        toolNameByCallId.get(callKey) ||
        String(message?.toolName || canonicalArtifact?.toolName || "tool_result");
      totalCount += 1;
      const attachments = dedupeAttachmentRefs([
        ...collectAttachmentRefsFromTransferEnvelopes(message?.transferEnvelopes),
        ...(Array.isArray(canonicalArtifact?.attachments) ? canonicalArtifact.attachments : []),
      ]);
      if (!callKey || !attachments.length) continue;
      artifactByCallId.set(callKey, {
        ...canonicalArtifact,
        toolCallId,
        toolName,
        ts: String(canonicalArtifact?.ts || ts).trim(),
        sessionId,
        dialogProcessId,
        parentDialogProcessId,
        turnScopeId,
        attachments,
      });
    }
  }
  const timelineByRoute = new Map();
  for (const artifact of artifactByCallId.values()) {
    const routeKey = routeKeyOf(artifact);
    if (!routeKey) continue;
    const resultEvent = {
      ...(artifact.eventId ? { eventId: artifact.eventId } : {}),
      ...(artifact.sequence > 0 ? { sequence: artifact.sequence } : {}),
      ...(artifact.sequenceScopeId ? { sequenceScopeId: artifact.sequenceScopeId } : {}),
      ...(artifact.authority ? { authority: artifact.authority } : {}),
      ...(artifact.sequenceDomain ? { sequenceDomain: artifact.sequenceDomain } : {}),
      ...(artifact.ts ? { timestamp: artifact.ts } : {}),
      ...(artifact.attachments.length ? { attachments: artifact.attachments } : {}),
      sessionId,
      dialogProcessId: artifact.dialogProcessId,
      turnScopeId: artifact.turnScopeId,
    };
    const timeline = timelineByRoute.get(routeKey) || [];
    timeline.push({
      key: `call:${artifact.toolCallId}`,
      toolCallId: artifact.toolCallId,
      tool: artifact.toolName,
      status: "completed",
      resultEvent,
    });
    timelineByRoute.set(routeKey, timeline);
  }
  return { timelineByRoute, totalCount };
}

export function buildSessionDisplaySummary(session = {}) {
  const messages = Array.isArray(session?.messages) ? session.messages : [];
  const terminalTurnScopeIds = [
    ...new Set(
      messages.map((message) => String(message?.turnScopeId || "").trim()).filter(Boolean),
    ),
  ];
  const turnTimings = Array.isArray(session?.turnTimings) ? session.turnTimings : [];
  const turnStatuses = Array.isArray(session?.turnStatuses) ? session.turnStatuses : [];
  const sessionId = String(session?.sessionId || "").trim();
  const lifecycle =
    session?.turnLifecycle && typeof session.turnLifecycle === "object"
      ? session.turnLifecycle
      : null;
  const lifecycleTurns =
    lifecycle?.turns && typeof lifecycle.turns === "object" ? lifecycle.turns : {};
  const firstUserMessage = messages.find(
    (messageItem) =>
      messageItem?.injectedMessage !== true &&
      String(messageItem?.role || "")
        .trim()
        .toLowerCase() === "user" &&
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
    const existingPresentation = projectedDisplayMessages.find(
      (message) =>
        String(message?.presentationMessageId || message?.messageId || message?.id || "").trim() ===
        presentationMessageId,
    );
    if (existingPresentation && String(existingPresentation?.role || "").trim() !== "assistant") {
      throw new TypeError("active Turn presentation invariant failed: presentation_role_conflict");
    }
    if (
      existingPresentation &&
      String(existingPresentation?.turnScopeId || "").trim() !== activeTurnPresentation.turnScopeId
    ) {
      throw new TypeError(
        "active Turn presentation invariant failed: presentation_turn_scope_conflict",
      );
    }
    if (!existingPresentation) {
      const owningUserIndex = projectedDisplayMessages.findLastIndex(
        (message) =>
          String(message?.role || "").trim() === "user" &&
          String(message?.turnScopeId || "").trim() === activeTurnPresentation.turnScopeId,
      );
      projectedDisplayMessages.splice(
        owningUserIndex >= 0 ? owningUserIndex + 1 : projectedDisplayMessages.length,
        0,
        activeTurnPresentation,
      );
    }
  }
  const displayMessageByIdentity = new Map();
  for (const message of projectedDisplayMessages) {
    const identity = String(
      message?.presentationMessageId || message?.messageId || message?.id || "",
    ).trim();
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
  for (const displayMessage of displayMessages) {
    if (String(displayMessage?.role || "").trim() !== "assistant") continue;
    const turnScopeId = String(displayMessage?.turnScopeId || "").trim();
    if (!turnScopeId) continue;
    const thinkingTimeline = projectThinkingTimeline(messages, displayMessage, { turnScopeId });
    if (!thinkingTimeline.toolTimeline.length && !thinkingTimeline.activityTimeline.length)
      continue;
    displayMessage.toolTimeline = compactThinkingTimeline(thinkingTimeline.toolTimeline);
    if (thinkingTimeline.activityTimeline.length) {
      displayMessage.activityTimeline = thinkingTimeline.activityTimeline;
    } else {
      delete displayMessage.activityTimeline;
    }
    displayMessage.hasThinkingDetails = true;
    displayMessage.thinkingDetailCount =
      thinkingTimeline.toolTimeline.length + thinkingTimeline.activityTimeline.length;
  }
  const injectedCount = messages.filter((message) => message?.injectedMessage === true).length;
  const thinkingCount = displayMessages.filter(
    (message) => message?.hasThinkingDetails === true,
  ).length;
  const { timelineByRoute, totalCount: toolLogCount } =
    buildToolArtifactTimelineProjection(session);
  let unassignedToolArtifactCount = 0;
  let assignedToolArtifactCount = 0;
  for (const [routeKey, toolTimeline] of timelineByRoute) {
    const candidates = displayMessages.filter(
      (message) =>
        String(message?.role || "").trim() === "assistant" &&
        `${sessionId}::${String(message?.turnScopeId || "").trim()}` === routeKey,
    );
    const dialogProcessIds = new Set(
      toolTimeline
        .map((item) =>
          String(item?.resultEvent?.dialogProcessId || item?.call?.dialogProcessId || "").trim(),
        )
        .filter(Boolean),
    );
    const matchingCandidates =
      dialogProcessIds.size === 1
        ? candidates.filter((message) => {
            const dialogProcessId = String(message?.dialogProcessId || "").trim();
            return !dialogProcessId || dialogProcessIds.has(dialogProcessId);
          })
        : candidates;
    if (matchingCandidates.length !== 1) {
      unassignedToolArtifactCount += toolTimeline.length;
      continue;
    }
    const presentation = matchingCandidates[0];
    const canonicalTimeline = Array.isArray(presentation?.toolTimeline)
      ? presentation.toolTimeline
      : [];
    const canonicalByKey = new Map(
      canonicalTimeline.map((item, index) => [
        String(item?.key || item?.toolCallId || "").trim(),
        index,
      ]),
    );
    for (const artifact of toolTimeline) {
      const key = String(artifact?.key || artifact?.toolCallId || "").trim();
      const index = canonicalByKey.get(key);
      if (index === undefined) {
        canonicalByKey.set(key, canonicalTimeline.length);
        canonicalTimeline.push(compactThinkingTimeline([artifact])[0]);
      } else {
        canonicalTimeline[index] = {
          ...canonicalTimeline[index],
          resultEvent: {
            ...(canonicalTimeline[index]?.resultEvent || {}),
            ...compactThinkingTimeline([artifact])[0]?.resultEvent,
          },
        };
      }
    }
    presentation.toolTimeline = canonicalTimeline;
    assignedToolArtifactCount += toolTimeline.length;
  }
  const attachmentCount = displayMessages.reduce((count, message) => {
    const sessionAttachments = dedupeSessionAttachmentRefs(
      Array.isArray(message?.attachments) ? message.attachments : [],
    );
    const transferAttachments = dedupeAttachmentRefs([
      ...collectAttachmentRefsFromTransferEnvelopes(message?.transferEnvelopes),
      ...(Array.isArray(message?.toolTimeline)
        ? message.toolTimeline.flatMap((item) =>
            Array.isArray(item?.resultEvent?.attachments) ? item.resultEvent.attachments : [],
          )
        : []),
    ]);
    return count + sessionAttachments.length + transferAttachments.length;
  }, 0);
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
    title:
      customTitle ||
      (firstUserMessage
        ? String(firstUserMessage.content || "").slice(0, 20)
        : sessionId.slice(0, 8)),
    aggregateVersion: session?.aggregateVersion,
    turnTimings,
    turnStatuses,
    turnLifecycleSnapshot,
    messages: displayMessages,
    stats: {
      messageCount: messages.length,
      displayMessageCount: displayMessages.length,
      injectedMessageCount: injectedCount,
      thinkingMessageCount: thinkingCount,
      toolLogCount,
      displayToolLogCount: assignedToolArtifactCount,
      unassignedToolArtifactCount,
      hasToolDetails: toolLogCount > 0,
      attachmentCount,
    },
  };
}

export function normalizeSessionsSummaryPayload(
  payload = {},
  now = () => new Date().toISOString(),
) {
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
      aggregateVersion: Math.max(0, Number(item?.aggregateVersion) || 0),
      title:
        String(item?.title || "").trim() ||
        String(item?.sessionId || "")
          .trim()
          .slice(0, 8),
      messageCount: Number.isFinite(Number(item?.messageCount)) ? Number(item.messageCount) : 0,
      lastMessage:
        item?.lastMessage &&
        typeof item.lastMessage === "object" &&
        !Array.isArray(item.lastMessage)
          ? item.lastMessage
          : null,
      ...(item?.availability === "unavailable" ? { messages: [] } : {}),
      availability: item?.availability === "unavailable" ? "unavailable" : "available",
      ...(item?.availability === "unavailable"
        ? {
            unavailableReason: {
              code: String(item?.unavailableReason?.code || "SESSION_PROTOCOL_INVALID").trim(),
              message: String(
                item?.unavailableReason?.message || "Session uses an unsupported protocol",
              ).trim(),
            },
          }
        : {}),
    }))
    .filter((item) => item.sessionId);
  return {
    schemaVersion: SESSIONS_SUMMARY_SCHEMA_VERSION,
    sessions,
    updatedAt: String(payload?.updatedAt || "").trim() || now(),
  };
}
