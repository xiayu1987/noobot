/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { fatalSystemError } from "../../error/index.js";
import { tSystem } from "noobot-i18n/agent/system-text";
import { ERROR_CODE } from "../../error/constants.js";
import { fsMkdir, fsReaddir, fsRm } from "../../store/fs-adapter.js";
import { normalizeSessionEntity } from "../entities/session-entity.js";

const SESSION_DISPLAY_SUMMARY_SCHEMA_VERSION = 2;
const REQUIRED_MESSAGE_SUMMARY_KEYS = new Set(["turnScopeId"]);

function compactMessageSummary(summary = {}) {
  return Object.fromEntries(
    Object.entries(summary).filter(
      ([key, value]) => REQUIRED_MESSAGE_SUMMARY_KEYS.has(key) || value !== "",
    ),
  );
}

function buildSessionSummary(session = {}, { depth = 0 } = {}) {
  const sessionId = String(session?.sessionId || "").trim();
  const messages = Array.isArray(session?.messages) ? session.messages : [];
  const firstUserMessage = messages.find(
    (messageItem) =>
      messageItem?.injectedMessage !== true &&
      String(messageItem?.role || "").trim().toLowerCase() === "user" &&
      String(messageItem?.content || "").trim(),
  );
  const lastMessage = messages.length ? buildMessageSummary(messages[messages.length - 1]) : null;
  return {
    sessionId,
    parentSessionId: String(session?.parentSessionId || "").trim(),
    caller: String(session?.caller || "user").trim() || "user",
    currentTaskId: String(session?.currentTaskId || "").trim(),
    createdAt: String(session?.createdAt || "").trim(),
    updatedAt: String(session?.updatedAt || "").trim(),
    depth: Number.isFinite(Number(depth)) ? Number(depth) : 0,
    title: firstUserMessage
      ? String(firstUserMessage.content || "").slice(0, 20)
      : sessionId.slice(0, 8),
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
    "isMonotonic",
    "monotonic",
    "monotonicState",
    "stopState",
    "state",
    "status",
    "channelState",
    "pluginMessage",
    "tool_call_id",
    "toolName",
    "turnScopeId",
  ]) {
    if (message?.[key] !== undefined) summary[key] = message[key];
  }
  return compactMessageSummary(summary);
}

function truncateText(value = "", maxLength = 4000) {
  const text = typeof value === "string" ? value : JSON.stringify(value ?? "");
  return text.length > maxLength ? `${text.slice(0, maxLength)}…` : text;
}

function pickLightAttachmentMetas(message = {}) {
  const metas = Array.isArray(message?.attachmentMetas) ? message.attachmentMetas : [];
  return metas.map((item = {}) => ({
    id: item?.id || item?.attachmentId || item?.fileId || "",
    name: item?.name || item?.fileName || item?.filename || "",
    type: item?.type || item?.mimeType || item?.mime || "",
    size: item?.size || item?.bytes || 0,
    owner: item?.owner || item?.source || "",
    url: item?.url || item?.downloadUrl || "",
    previewUrl: item?.previewUrl || "",
    ...(item?.turnScope && typeof item.turnScope === "object" && !Array.isArray(item.turnScope)
      ? { turnScope: item.turnScope }
      : {}),
  })).filter((item) => item.id || item.name || item.url || item.previewUrl);
}

function tryParseJsonContent(content = "") {
  try {
    return JSON.parse(String(content || ""));
  } catch {
    return null;
  }
}

function resolveBaseName(filePath = "") {
  const normalized = String(filePath || "").trim().replaceAll("\\", "/");
  if (!normalized) return "";
  const parts = normalized.split("/");
  return String(parts[parts.length - 1] || "").trim();
}

function parseToolFileResult(content = "") {
  const parsed = tryParseJsonContent(content);
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
  const toolName = String(parsed?.toolName || "").trim();
  if (!["write_file"].includes(toolName)) return null;
  if (parsed?.ok === false) return null;
  if (toolName === "write_file" && String(parsed?.state || "").toUpperCase() !== "OK") return null;
  const resolvedPath = String(parsed?.resolvedPath || parsed?.path || "").trim();
  const fileName = String(parsed?.fileName || resolveBaseName(resolvedPath)).trim();
  if (!resolvedPath || !fileName) return null;
  return { toolName, resolvedPath, fileName };
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
        .map((item) => (["string", "number", "boolean"].includes(typeof item) ? item : truncateText(item, 500)));
    } else if (typeof value === "object") {
      picked[key] = truncateText(value, 1000);
    }
  }
  return Object.keys(picked).length ? picked : null;
}

function clonePlainJson(value, { maxStringLength = 2000 } = {}) {
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

function pickLightPayloadTransferEnvelopes(value = []) {
  return (Array.isArray(value) ? value : [])
    .filter((item) => item && typeof item === "object" && !Array.isArray(item))
    .slice(0, 50)
    .map((item) => pickPlainFields(item, [
      "id", "type", "from", "to", "status", "state", "title", "label", "createdAt", "updatedAt",
    ], { maxStringLength: 500 }))
    .filter(Boolean);
}

function pickPayloadStepFailure(value) {
  if (!value) return null;
  if (typeof value === "string") return truncateText(value, 1000);
  if (typeof value !== "object" || Array.isArray(value)) return null;
  return pickPlainFields(value, ["message", "error", "code", "name", "stack"], { maxStringLength: 1000 });
}

function pickPayloadSemantic(semantic = {}) {
  if (!semantic || typeof semantic !== "object" || Array.isArray(semantic)) return null;
  return pickPlainFields(semantic, ["nodes", "flowtos", "edges", "attachments"], { maxStringLength: 2000 });
}

function pickPayloadNodeRun(item = {}) {
  if (!item || typeof item !== "object" || Array.isArray(item)) return null;
  const picked = pickPlainFields(item, [
    "transition", "stepId", "stepIndex", "actionNodeStateId", "nodeDialogId", "dialogId",
    "nodeSessionId", "sessionId", "rootSessionId", "stepStatus", "status", "parallelWave", "waveOrder",
  ], { maxStringLength: 1000 }) || {};
  const step = pickPlainFields(item?.step, [
    "nodeId", "nodeName", "nodeType", "type", "stateType", "stepId", "stepIndex", "actionNodeStateId",
  ], { maxStringLength: 1000 });
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
    "type", "stateType", "rootSessionId", "dialogId", "sessionId", "stepStatus", "status",
    "parallelWave", "waveOrder",
  ], { maxStringLength: 1000 }) || {};
  const stepFailure = pickPayloadStepFailure(item?.stepFailure);
  if (stepFailure) picked.stepFailure = stepFailure;
  const envelopes = pickLightPayloadTransferEnvelopes(item?.transferEnvelopes || item?.nodeResultTransferEnvelopes);
  if (envelopes.length) picked.transferEnvelopes = envelopes;
  return Object.keys(picked).length ? picked : null;
}

function pickPluginPayloadSnapshot(payload = {}) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return null;
  const picked = pickPlainFields(payload, ["status", "phase", "phaseStatus"], { maxStringLength: 500 }) || {};
  const semantic = pickPayloadSemantic(payload?.semantic);
  if (semantic) picked.semantic = semantic;
  if (payload?.execution && typeof payload.execution === "object" && !Array.isArray(payload.execution)) {
    const execution = pickPlainFields(payload.execution, ["completed", "status", "startedAt", "endedAt", "error"], { maxStringLength: 1000 }) || {};
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
  const planningDialog = pickPlainFields(payload?.planningDialog, ["sessionId", "dialogId", "parentSessionId"], { maxStringLength: 1000 });
  if (planningDialog) picked.planningDialog = planningDialog;
  const runMeta = pickPlainFields(payload?.runMeta, ["sessionId", "dialogId", "parentSessionId", "runId"], { maxStringLength: 1000 });
  if (runMeta) picked.runMeta = runMeta;
  const interaction = pickPlainFields(payload?.interaction, ["semanticTextPreview"], { maxStringLength: 4000 });
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
    .map((envelope) => pickLightObject(envelope, [
    "id", "type", "from", "to", "status", "state", "title", "label", "createdAt", "updatedAt",
    ]))
    .filter(Boolean)
    .filter((item) => {
      const key = JSON.stringify(item);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
}

function buildDisplayMessageSummary(message = {}) {
  if (!message || typeof message !== "object" || Array.isArray(message)) return null;
  const role = String(message?.role || "").trim();
  if (!role || message?.injectedMessage === true) return null;
  const type = String(message?.type || "").trim();
  if (!["user", "assistant"].includes(role)) return null;
  if (["tool_call", "tool_result"].includes(type)) return null;
  const summary = buildMessageSummary(message) || {};
  summary.content = typeof message?.content === "string" ? message.content : JSON.stringify(message?.content ?? "");
  const attachmentMetas = pickLightAttachmentMetas(message);
  if (attachmentMetas.length) summary.attachmentMetas = attachmentMetas;
  for (const key of ["id", "messageId", "pluginMessage", "done", "pending", "error"]) {
    if (message?.[key] !== undefined) summary[key] = message[key];
  }
  const pluginMeta = pickLightPluginMeta(message);
  const transferEnvelopes = pickLightTransferEnvelopes(message);
  if (pluginMeta) summary.pluginMeta = pluginMeta;
  if (transferEnvelopes.length) summary.transferEnvelopes = transferEnvelopes;
  if (Array.isArray(message?.realtimeLogs) || Array.isArray(message?.completedToolLogs)) {
    summary.hasThinkingDetails = true;
    summary.thinkingDetailCount =
      (Array.isArray(message?.realtimeLogs) ? message.realtimeLogs.length : 0) +
      (Array.isArray(message?.completedToolLogs) ? message.completedToolLogs.length : 0);
  }
  if (Array.isArray(message?.tool_calls) && message.tool_calls.length) {
    summary.toolCalls = message.tool_calls.map((toolCall = {}) => ({
      id: String(toolCall?.id || "").trim(),
      name: String(toolCall?.function?.name || toolCall?.name || "").trim(),
    })).filter((item) => item.id || item.name);
  }
  return compactMessageSummary(summary);
}

function buildToolLogSummaries(session = {}, { depth = 0 } = {}) {
  const messages = Array.isArray(session?.messages) ? session.messages : [];
  const sessionId = String(session?.sessionId || "").trim();
  const toolNameByCallId = new Map();
  const logs = [];
  let totalCount = 0;
  for (const message of messages) {
    const role = String(message?.role || "").trim();
    const type = String(message?.type || "").trim();
    const ts = String(message?.ts || "").trim();
    const dialogProcessId = String(message?.dialogProcessId || "").trim();
    const parentDialogProcessId = String(message?.parentDialogProcessId || "").trim();
    const turnScopeId = String(message?.turnScopeId || "").trim();
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
      const attachmentMetas = pickLightAttachmentMetas(message);
      const writtenFile = parseToolFileResult(message?.content || "");
      if (!attachmentMetas.length && !writtenFile) continue;
      const summary = {
        event: "tool_result", type: "tool_result",
        role: "tool",
        toolName,
        text: writtenFile ? `${writtenFile.toolName} ${writtenFile.fileName}` : truncateText(`${toolName}`.trim(), 200),
        ts, sessionId, depth, toolCallId, dialogProcessId, parentDialogProcessId, turnScopeId,
      };
      if (attachmentMetas.length) summary.attachmentMetas = attachmentMetas;
      if (writtenFile) {
        summary.writtenFiles = [{ ...writtenFile, sourceType: "tool", recognized: false }];
      }
      logs.push(summary);
    }
  }
  return { logs, totalCount };
}

function collectMessageCorrelationKeys(message = {}) {
  const keys = [];
  for (const key of ["turnScopeId", "dialogProcessId", "parentDialogProcessId"]) {
    const value = String(message?.[key] || "").trim();
    if (value && !keys.includes(value)) keys.push(value);
  }
  return keys;
}

function countMessageThinkingDetails(message = {}) {
  if (!message || typeof message !== "object" || Array.isArray(message)) return 0;
  const role = String(message?.role || "").trim();
  const type = String(message?.type || "").trim();
  let count = 0;
  if (Array.isArray(message?.realtimeLogs)) count += message.realtimeLogs.length;
  if (Array.isArray(message?.completedToolLogs)) count += message.completedToolLogs.length;
  if (type === "tool_call") count += Math.max(1, Array.isArray(message?.tool_calls) ? message.tool_calls.length : 0);
  if (role === "tool" || type === "tool_result") count += 1;
  return count;
}

function buildThinkingDetailCountsByCorrelationKey(messages = []) {
  const counts = new Map();
  for (const message of messages) {
    const role = String(message?.role || "").trim();
    const type = String(message?.type || "").trim();
    const isDisplayMessage = ["user", "assistant"].includes(role) && !["tool_call", "tool_result"].includes(type) && message?.injectedMessage !== true;
    if (isDisplayMessage) continue;
    const count = countMessageThinkingDetails(message);
    if (!count) continue;
    for (const key of collectMessageCorrelationKeys(message)) {
      counts.set(key, (counts.get(key) || 0) + count);
    }
  }
  return counts;
}

function resolveThinkingDetailCountForDisplayMessage(message = {}, countsByKey = new Map()) {
  let count = countMessageThinkingDetails(message);
  for (const key of collectMessageCorrelationKeys(message)) {
    count += countsByKey.get(key) || 0;
  }
  return count;
}

function buildSessionDisplaySummary(session = {}, { depth = 0 } = {}) {
  const messages = Array.isArray(session?.messages) ? session.messages : [];
  const thinkingDetailCountsByKey = buildThinkingDetailCountsByCorrelationKey(messages);
  const displayMessages = messages
    .map((message) => {
      const summary = buildDisplayMessageSummary(message);
      if (!summary) return null;
      if (String(message?.role || "").trim() === "assistant") {
        const thinkingDetailCount = resolveThinkingDetailCountForDisplayMessage(message, thinkingDetailCountsByKey);
        if (thinkingDetailCount > 0) {
          summary.hasThinkingDetails = true;
          summary.thinkingDetailCount = thinkingDetailCount;
        }
      }
      return summary;
    })
    .filter(Boolean);
  const injectedCount = messages.filter((message) => message?.injectedMessage === true).length;
  const thinkingCount = displayMessages.filter((message) => message?.hasThinkingDetails === true).length;
  const { logs: toolLogSummaries, totalCount: toolLogCount } = buildToolLogSummaries(session, { depth });
  const attachmentCount = displayMessages.reduce(
    (count, message) => count + (Array.isArray(message?.attachmentMetas) ? message.attachmentMetas.length : 0),
    0,
  );
  return {
    schemaVersion: SESSION_DISPLAY_SUMMARY_SCHEMA_VERSION,
    sessionId: String(session?.sessionId || "").trim(),
    parentSessionId: String(session?.parentSessionId || "").trim(),
    caller: String(session?.caller || "user").trim() || "user",
    currentTaskId: String(session?.currentTaskId || "").trim(),
    createdAt: String(session?.createdAt || "").trim(),
    updatedAt: String(session?.updatedAt || "").trim(),
    version: session?.version,
    revision: session?.revision,
    depth: Number.isFinite(Number(depth)) ? Number(depth) : 0,
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

function normalizeSessionsSummaryPayload(payload = {}, now = () => new Date().toISOString()) {
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

export class FileSystemSessionRepository {
  constructor({
    pathResolver,
    sessionPathResolver,
    storageService,
    normalizeMessages,
    normalizeSelectedConnectors,
    now = () => new Date().toISOString(),
    deletedSessionGuardTtlMs = 15 * 60 * 1000,
  } = {}) {
    this.pathResolver = pathResolver;
    this.sessionPathResolver = sessionPathResolver;
    this.storageService = storageService;
    this.normalizeMessages = normalizeMessages;
    this.normalizeSelectedConnectors = normalizeSelectedConnectors;
    this.now = now;
    this.deletedSessionGuardTtlMs =
      Number.isFinite(Number(deletedSessionGuardTtlMs)) && Number(deletedSessionGuardTtlMs) > 0
        ? Number(deletedSessionGuardTtlMs)
        : 15 * 60 * 1000;
    this._deletedSessionCache = new Map(); // userId -> { sessions, updatedAt }
  }

  _basePath(userId = "") {
    return this.pathResolver.resolveBasePath(userId);
  }

  _sessionRoot(userId = "") {
    return this.pathResolver.sessionRoot(this._basePath(userId));
  }

  _deletedSessionMarkerFile(userId = "") {
    if (typeof this.pathResolver?.deletedSessionMarkerFile === "function") {
      return this.pathResolver.deletedSessionMarkerFile(this._basePath(userId));
    }
    return `${this._sessionRoot(userId)}/.deleted-sessions.json`;
  }

  _sessionsSummaryFile(userId = "") {
    if (typeof this.pathResolver?.sessionsSummaryFile === "function") {
      return this.pathResolver.sessionsSummaryFile(this._basePath(userId));
    }
    return `${this._sessionRoot(userId)}/sessions.json`;
  }

  _sortSummaries(sessions = []) {
    return [...sessions].sort(
      (leftSession, rightSession) =>
        new Date(rightSession.updatedAt || 0).getTime() -
        new Date(leftSession.updatedAt || 0).getTime(),
    );
  }

  _withSummaryDepth(session = {}, sessionTree = null) {
    const sessionId = String(session?.sessionId || "").trim();
    if (!sessionId || !sessionTree?.nodes?.[sessionId]) return buildSessionSummary(session, { depth: 0 });
    const visited = new Set();
    let depth = 0;
    let currentId = sessionId;
    while (currentId && !visited.has(currentId) && sessionTree?.nodes?.[currentId]) {
      visited.add(currentId);
      depth += 1;
      currentId = String(sessionTree.nodes[currentId]?.parentSessionId || "").trim();
    }
    return buildSessionSummary(session, { depth });
  }

  async readSessionsSummary(userId = "") {
    const normalizedUserId = String(userId || "").trim();
    if (!normalizedUserId) return { sessions: [], updatedAt: this.now() };
    const payload = await this.storageService.readJson(
      this._sessionsSummaryFile(normalizedUserId),
      { sessions: [], updatedAt: this.now() },
    );
    return normalizeSessionsSummaryPayload(payload, this.now);
  }

  async writeSessionsSummary(userId = "", sessions = []) {
    const normalizedUserId = String(userId || "").trim();
    if (!normalizedUserId) return { sessions: [], updatedAt: this.now() };
    await this.storageService.ensureRuntimeDirsByBasePath(this._basePath(normalizedUserId));
    const payload = normalizeSessionsSummaryPayload(
      { sessions: this._sortSummaries(sessions), updatedAt: this.now() },
      this.now,
    );
    await this.storageService.writeJsonAtomic(
      this._sessionsSummaryFile(normalizedUserId),
      payload,
    );
    return payload;
  }

  async upsertSessionSummary(userId = "", session = {}, { sessionTree = null } = {}) {
    const summary = this._withSummaryDepth(session, sessionTree);
    if (!summary.sessionId) return null;
    const current = await this.readSessionsSummary(userId);
    const nextMap = new Map(current.sessions.map((item) => [item.sessionId, item]));
    nextMap.set(summary.sessionId, summary);
    await this.writeSessionsSummary(userId, Array.from(nextMap.values()));
    return summary;
  }

  async removeSessionSummaries(userId = "", sessionIds = []) {
    const ids = new Set(
      (Array.isArray(sessionIds) ? sessionIds : [sessionIds])
        .map((item) => String(item || "").trim())
        .filter(Boolean),
    );
    if (!ids.size) return 0;
    const current = await this.readSessionsSummary(userId);
    const next = current.sessions.filter((item) => !ids.has(item.sessionId));
    if (next.length === current.sessions.length) return 0;
    await this.writeSessionsSummary(userId, next);
    return current.sessions.length - next.length;
  }

  async rebuildSessionsSummary(userId = "", { sessionTree = null } = {}) {
    const tree = sessionTree || null;
    const treeSessionIds = Object.keys(tree?.nodes || {});
    const sessionIds = treeSessionIds.length ? treeSessionIds : await this.listSessionIds(userId);
    const summaries = [];
    for (const sessionId of sessionIds) {
      const parentSessionId = String(tree?.nodes?.[sessionId]?.parentSessionId || "").trim();
      const session = await this.findById(userId, sessionId, parentSessionId);
      if (!session) continue;
      summaries.push(this._withSummaryDepth(session, tree));
    }
    return this.writeSessionsSummary(userId, summaries);
  }

  async _readDeletedSessions(userId = "") {
    const normalizedUserId = String(userId || "").trim();
    if (!normalizedUserId) return { sessions: {}, updatedAt: this.now() };
    const markerFile = this._deletedSessionMarkerFile(normalizedUserId);
    const raw = await this.storageService.readJson(markerFile, null);
    const currentSessions =
      raw?.sessions && typeof raw.sessions === "object" && !Array.isArray(raw.sessions)
        ? raw.sessions
        : {};
    const nowMs = Date.now();
    const ttlMs = this.deletedSessionGuardTtlMs;
    let pruned = false;
    const nextSessions = {};
    for (const [sessionId, deletedAt] of Object.entries(currentSessions)) {
      const normalizedSessionId = String(sessionId || "").trim();
      const deletedAtMs = Number(deletedAt);
      if (!normalizedSessionId || !Number.isFinite(deletedAtMs)) {
        pruned = true;
        continue;
      }
      if (nowMs - deletedAtMs > ttlMs) {
        pruned = true;
        continue;
      }
      nextSessions[normalizedSessionId] = deletedAtMs;
    }
    const payload = {
      sessions: nextSessions,
      updatedAt: String(raw?.updatedAt || this.now()),
    };
    if (pruned) {
      await this.storageService.writeJsonAtomic(markerFile, {
        sessions: nextSessions,
        updatedAt: this.now(),
      });
      payload.updatedAt = this.now();
    }
    this._deletedSessionCache.set(normalizedUserId, payload);
    return payload;
  }

  async _writeDeletedSessions(userId = "", sessions = {}) {
    const normalizedUserId = String(userId || "").trim();
    if (!normalizedUserId) return false;
    const markerFile = this._deletedSessionMarkerFile(normalizedUserId);
    const payload = {
      sessions:
        sessions && typeof sessions === "object" && !Array.isArray(sessions)
          ? sessions
          : {},
      updatedAt: this.now(),
    };
    await this.storageService.writeJsonAtomic(markerFile, payload);
    this._deletedSessionCache.set(normalizedUserId, payload);
    return true;
  }

  async markSessionsDeleted(userId = "", sessionIds = []) {
    const normalizedUserId = String(userId || "").trim();
    if (!normalizedUserId) return 0;
    const ids = (Array.isArray(sessionIds) ? sessionIds : [sessionIds])
      .map((item) => String(item || "").trim())
      .filter(Boolean);
    if (!ids.length) return 0;
    await this.storageService.ensureRuntimeDirsByBasePath(this._basePath(normalizedUserId));
    const current = await this._readDeletedSessions(normalizedUserId);
    const nextSessions = {
      ...(current?.sessions && typeof current.sessions === "object" ? current.sessions : {}),
    };
    const deletedAt = Date.now();
    let marked = 0;
    for (const sessionId of ids) {
      nextSessions[sessionId] = deletedAt;
      marked += 1;
    }
    await this._writeDeletedSessions(normalizedUserId, nextSessions);
    await this.removeSessionSummaries(normalizedUserId, ids);
    await this.removeSessionDisplaySummaries(normalizedUserId, ids);
    return marked;
  }

  async isSessionDeleted(userId = "", sessionId = "") {
    const normalizedSessionId = String(sessionId || "").trim();
    if (!normalizedSessionId) return false;
    const payload = await this._readDeletedSessions(userId);
    return Boolean(payload?.sessions?.[normalizedSessionId]);
  }

  async resolveParentSessionId(userId, sessionId, parentSessionId = "") {
    return this.sessionPathResolver.resolveParentSessionId(
      userId,
      sessionId,
      parentSessionId,
    );
  }

  async resolveSessionDir(userId, sessionId, parentSessionId = "") {
    return this.sessionPathResolver.resolveSessionDir(
      userId,
      sessionId,
      parentSessionId,
    );
  }

  async resolveSessionScope(userId, sessionId, parentSessionId = "") {
    return this.sessionPathResolver.resolveSessionScope(
      userId,
      sessionId,
      parentSessionId,
    );
  }


  async _sessionDisplaySummaryFile(userId, sessionId, parentSessionId = "") {
    const { sessionDir } = await this.resolveSessionScope(userId, sessionId, parentSessionId);
    return `${sessionDir}/session-summary.json`;
  }

  async readSessionDisplaySummary(userId = "", sessionId = "", parentSessionId = "") {
    const normalizedSessionId = String(sessionId || "").trim();
    if (!normalizedSessionId) return null;
    const payload = await this.storageService.readJson(
      await this._sessionDisplaySummaryFile(userId, normalizedSessionId, parentSessionId),
      null,
    );
    if (!payload || typeof payload !== "object" || Array.isArray(payload)) return null;
    if (Number(payload?.schemaVersion || 0) !== SESSION_DISPLAY_SUMMARY_SCHEMA_VERSION) return null;
    if (String(payload?.sessionId || "").trim() !== normalizedSessionId) return null;
    return payload;
  }

  async writeSessionDisplaySummary(userId = "", session = {}, { depth = 0 } = {}) {
    const sessionId = String(session?.sessionId || "").trim();
    if (!sessionId) return null;
    const payload = buildSessionDisplaySummary(session, { depth });
    await this.storageService.writeJsonAtomic(
      await this._sessionDisplaySummaryFile(userId, sessionId, session?.parentSessionId || ""),
      payload,
    );
    return payload;
  }

  async rebuildSessionDisplaySummary(userId = "", sessionId = "", parentSessionId = "", { depth = 0 } = {}) {
    const session = await this.findById(userId, sessionId, parentSessionId);
    if (!session) return null;
    return this.writeSessionDisplaySummary(userId, session, { depth });
  }

  async removeSessionDisplaySummaries(userId = "", sessionIds = []) {
    const ids = (Array.isArray(sessionIds) ? sessionIds : [sessionIds])
      .map((item) => String(item || "").trim())
      .filter(Boolean);
    let removed = 0;
    for (const sessionId of ids) {
      try {
        await fsRm(await this._sessionDisplaySummaryFile(userId, sessionId, ""), { force: true });
        removed += 1;
      } catch {
        // Best-effort cleanup. Nested session directories are removed by delete().
      }
    }
    return removed;
  }

  async listSessionIds(userId) {
    const basePath = this._basePath(userId);
    await this.storageService.ensureRuntimeDirsByBasePath(basePath);
    let entries = [];
    try {
      entries = await fsReaddir(this._sessionRoot(userId), { withFileTypes: true });
    } catch {
      return [];
    }
    const deletedSessions = await this._readDeletedSessions(userId);
    const deletedSet = new Set(Object.keys(deletedSessions?.sessions || {}));
    return entries
      .filter((dirEntry) => dirEntry.isDirectory())
      .map((dirEntry) => dirEntry.name)
      .filter((sessionId) => !deletedSet.has(String(sessionId || "").trim()));
  }

  async ensureSession({ userId, sessionId, parentSessionId = "", meta = {} }) {
    if (await this.isSessionDeleted(userId, sessionId)) return false;
    const basePath = this._basePath(userId);
    await this.storageService.ensureRuntimeDirsByBasePath(basePath);
    const { resolvedParentSessionId, sessionDir, sessionFile } =
      await this.resolveSessionScope(userId, sessionId, parentSessionId);

    await fsMkdir(sessionDir, { recursive: true });

    if (!(await this.storageService.exists(sessionFile))) {
      const payload = normalizeSessionEntity(
        {
          sessionId,
          parentSessionId: resolvedParentSessionId || "",
          caller: meta?.caller || "user",
          modelAlias: meta?.modelAlias || "",
          currentTaskId: "",
          shortMemoryCheckpoint: 0,
          messages: [],
          selectedConnectors: {},
        },
        { now: this.now, sessionId, parentSessionId: resolvedParentSessionId || "" },
      );
      await this.storageService.writeJson(sessionFile, payload);
      await this.upsertSessionSummary(userId, payload);
      await this.writeSessionDisplaySummary(userId, payload);
    }
    return true;
  }

  async findById(userId, sessionId, parentSessionId = "") {
    if (await this.isSessionDeleted(userId, sessionId)) return null;
    const { resolvedParentSessionId, sessionFile } = await this.resolveSessionScope(
      userId,
      sessionId,
      parentSessionId,
    );
    if (!(await this.storageService.exists(sessionFile))) return null;

    const session = await this.storageService.readJson(sessionFile, {});
    session.sessionId = String(session.sessionId || sessionId || "").trim();
    session.parentSessionId = String(
      session.parentSessionId || resolvedParentSessionId || "",
    ).trim();
    session.caller = String(session.caller || "user").trim() || "user";
    session.modelAlias = String(session.modelAlias || "");
    session.messages = this.normalizeMessages(session.messages || []);
    session.selectedConnectors = this.normalizeSelectedConnectors(
      session.selectedConnectors || {},
    );
    return session;
  }

  async save(userId, session = {}, parentSessionId = "") {
    const sessionId = String(session?.sessionId || "").trim();
    if (!sessionId) {
      throw fatalSystemError(tSystem("common.sessionIdRequired"), {
        code: ERROR_CODE.FATAL_SESSION_ID_REQUIRED,
      });
    }
    if (await this.isSessionDeleted(userId, sessionId)) return false;
    const { resolvedParentSessionId, sessionFile } = await this.resolveSessionScope(
      userId,
      sessionId,
      parentSessionId || session?.parentSessionId || "",
    );
    const payload = normalizeSessionEntity(
      {
        ...session,
        sessionId,
        parentSessionId: String(
          session?.parentSessionId || resolvedParentSessionId || "",
        ).trim(),
        updatedAt: this.now(),
      },
      { now: this.now, sessionId, parentSessionId: resolvedParentSessionId || "" },
    );
    await this.storageService.writeJson(sessionFile, payload);
    await this.upsertSessionSummary(userId, payload);
    await this.writeSessionDisplaySummary(userId, payload);
    return true;
  }

  async delete(userId, sessionId, parentSessionId = "") {
    const { sessionDir } = await this.resolveSessionScope(
      userId,
      sessionId,
      parentSessionId,
    );
    await fsRm(sessionDir, { recursive: true, force: true });
    await this.removeSessionSummaries(userId, [sessionId]);
    await this.removeSessionDisplaySummaries(userId, [sessionId]);
    return true;
  }
}
