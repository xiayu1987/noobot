/*
 * Copyright (c) 2026 xiayu
 * SPDX-License-Identifier: MIT
 */
import fs from "node:fs/promises";
import path from "node:path";
import { AIMessage, HumanMessage, SystemMessage, ToolMessage } from "@langchain/core/messages";

function cleanId(value = "") {
  return String(value || "").trim().replace(/[^a-zA-Z0-9._-]/g, "_");
}

function snapshotDir({ globalConfig = {}, userId = "", sessionId = "" } = {}) {
  const root = String(globalConfig?.workspaceRoot || process.cwd()).trim();
  return path.resolve(root, cleanId(userId), "runtime", "session", cleanId(sessionId), "model-message-snapshots");
}

function snapshotPath(identity = {}, globalConfig = {}) {
  return path.join(snapshotDir({ globalConfig, ...identity }), `${cleanId(identity.dialogProcessId)}__${cleanId(identity.turnScopeId)}.json`);
}

function messageType(message = {}) {
  if (typeof message?._getType === "function") return message._getType();
  return String(message?.type || message?.role || message?.lc_kwargs?.type || "").toLowerCase();
}

function cloneJson(value) {
  if (value == null) return value;
  try { return JSON.parse(JSON.stringify(value)); } catch { return value; }
}

function serializeMessage(message = {}) {
  const type = messageType(message);
  const rawKwargs = message?.additional_kwargs || message?.lc_kwargs?.additional_kwargs || {};
  const normalizedType = type === "system"
    ? "system"
    : type === "ai" || type === "assistant"
      ? "ai"
      : type === "tool" || type === "tool_result"
        ? "tool"
        : "human";
  const serialized = {
    type: normalizedType,
    content: typeof message?.content === "string" ? message.content : message?.content ?? "",
    additional_kwargs: cloneJson(rawKwargs) || {},
  };
  if (normalizedType === "ai") {
    if (Array.isArray(message?.tool_calls)) serialized.tool_calls = cloneJson(message.tool_calls) || [];
    if (Array.isArray(message?.invalid_tool_calls)) serialized.invalid_tool_calls = cloneJson(message.invalid_tool_calls) || [];
  }
  if (normalizedType === "tool") {
    serialized.tool_call_id = message?.tool_call_id || message?.lc_kwargs?.tool_call_id || message?.additional_kwargs?.tool_call_id || "";
    if (message?.name) serialized.name = message.name;
    if (message?.status) serialized.status = message.status;
    if (message?.artifact !== undefined) serialized.artifact = cloneJson(message.artifact);
  }
  return serialized;
}

function deserializeMessage(item = {}) {
  const payload = { content: item?.content ?? "", additional_kwargs: cloneJson(item?.additional_kwargs) || {} };
  if (item?.type === "system") return new SystemMessage(payload);
  if (item?.type === "ai") return new AIMessage({
    ...payload,
    tool_calls: cloneJson(item?.tool_calls) || [],
    invalid_tool_calls: cloneJson(item?.invalid_tool_calls) || [],
  });
  if (item?.type === "tool") return new ToolMessage({
    ...payload,
    tool_call_id: item?.tool_call_id || "",
    name: item?.name,
    status: item?.status,
    artifact: cloneJson(item?.artifact),
  });
  return new HumanMessage(payload);
}

function serializeList(list = []) {
  return (Array.isArray(list) ? list : []).map(serializeMessage).filter(Boolean);
}

function deserializeList(list = []) {
  return (Array.isArray(list) ? list : []).map(deserializeMessage);
}

function assertIdentity(snapshot = {}, identity = {}) {
  for (const key of ["userId", "sessionId", "dialogProcessId", "turnScopeId"]) {
    if (String(snapshot?.[key] || "").trim() !== String(identity?.[key] || "").trim()) {
      throw new Error(`Stopped model message snapshot identity mismatch: ${key}`);
    }
  }
}

function countSnapshotMessages(candidate = {}) {
  return {
    messageCount: Array.isArray(candidate.messages) ? candidate.messages.length : 0,
    systemCount: Array.isArray(candidate.messageBlocks?.system) ? candidate.messageBlocks.system.length : 0,
    historyCount: Array.isArray(candidate.messageBlocks?.history) ? candidate.messageBlocks.history.length : 0,
    incrementalCount: Array.isArray(candidate.messageBlocks?.incremental) ? candidate.messageBlocks.incremental.length : 0,
  };
}

function buildSnapshotPersistenceResult({ status, source = "", reason = "", identity = {}, missingIdentityFields = [], error = "", candidate = null } = {}) {
  return {
    status,
    source: String(source || ""),
    ...(reason ? { reason } : {}),
    ...(identity && typeof identity === "object" ? { identity } : {}),
    ...(Array.isArray(missingIdentityFields) && missingIdentityFields.length ? { missingIdentityFields } : {}),
    ...(error ? { error: String(error || "") } : {}),
    ...countSnapshotMessages(candidate || {}),
  };
}

export async function saveStoppedModelMessageSnapshot({ globalConfig = {}, identity = {}, messages = [], messageBlocks = {} } = {}) {
  const normalizedIdentity = {
    userId: String(identity.userId || "").trim(),
    sessionId: String(identity.sessionId || "").trim(),
    parentSessionId: String(identity.parentSessionId || "").trim(),
    dialogProcessId: String(identity.dialogProcessId || "").trim(),
    turnScopeId: String(identity.turnScopeId || "").trim(),
  };
  if (!normalizedIdentity.userId || !normalizedIdentity.sessionId || !normalizedIdentity.dialogProcessId || !normalizedIdentity.turnScopeId) return null;
  const now = new Date().toISOString();
  const snapshot = {
    version: 1,
    ...normalizedIdentity,
    createdAt: now,
    updatedAt: now,
    messageBlocks: {
      system: serializeList(messageBlocks.system),
      history: serializeList(messageBlocks.history),
      incremental: serializeList(messageBlocks.incremental),
    },
    messages: serializeList(messages),
  };
  const filePath = snapshotPath(normalizedIdentity, globalConfig);
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, JSON.stringify(snapshot, null, 2), "utf8");
  return snapshot;
}

export async function saveStoppedModelMessageSnapshotCandidate({
  globalConfig = {},
  candidate = null,
  eventListener = null,
  source = "",
} = {}) {
  if (!candidate || typeof candidate !== "object") {
    const result = buildSnapshotPersistenceResult({
      status: "skipped",
      source,
      reason: "missing_candidate",
    });
    eventListener?.onEvent?.({
      event: "stopped_model_message_snapshot_save_skipped",
      data: result,
    });
    return result;
  }
  const identity = {
    userId: String(candidate.userId || "").trim(),
    sessionId: String(candidate.sessionId || "").trim(),
    parentSessionId: String(candidate.parentSessionId || "").trim(),
    dialogProcessId: String(candidate.dialogProcessId || "").trim(),
    turnScopeId: String(candidate.turnScopeId || "").trim(),
  };
  const missingIdentityFields = ["userId", "sessionId", "dialogProcessId", "turnScopeId"]
    .filter((key) => !identity[key]);
  if (missingIdentityFields.length) {
    const result = buildSnapshotPersistenceResult({
      status: "skipped",
      source,
      reason: "missing_identity",
      missingIdentityFields,
      identity,
      candidate,
    });
    eventListener?.onEvent?.({
      event: "stopped_model_message_snapshot_save_skipped",
      data: result,
    });
    return result;
  }
  try {
    await saveStoppedModelMessageSnapshot({
      globalConfig,
      identity,
      messages: candidate.messages,
      messageBlocks: candidate.messageBlocks,
    });
    const result = buildSnapshotPersistenceResult({
      status: "saved",
      source,
      identity,
      candidate,
    });
    eventListener?.onEvent?.({
      event: "stopped_model_message_snapshot_saved",
      data: result,
    });
    return result;
  } catch (error) {
    const result = buildSnapshotPersistenceResult({
      status: "failed",
      source,
      identity,
      error: String(error?.message || error || ""),
      candidate,
    });
    eventListener?.onEvent?.({
      event: "stopped_model_message_snapshot_save_failed",
      data: result,
    });
    return result;
  }
}

export async function loadStoppedModelMessageSnapshot({ globalConfig = {}, identity = {} } = {}) {
  const normalizedIdentity = {
    userId: String(identity.userId || "").trim(),
    sessionId: String(identity.sessionId || "").trim(),
    dialogProcessId: String(identity.dialogProcessId || "").trim(),
    turnScopeId: String(identity.turnScopeId || "").trim(),
  };
  const filePath = snapshotPath(normalizedIdentity, globalConfig);
  const raw = await fs.readFile(filePath, "utf8");
  const snapshot = JSON.parse(raw);
  assertIdentity(snapshot, normalizedIdentity);
  return {
    ...snapshot,
    messageBlocks: {
      system: deserializeList(snapshot?.messageBlocks?.system),
      history: deserializeList(snapshot?.messageBlocks?.history),
      incremental: deserializeList(snapshot?.messageBlocks?.incremental),
    },
    messages: deserializeList(snapshot?.messages),
  };
}

export async function clearStoppedModelMessageSnapshot({ globalConfig = {}, identity = {} } = {}) {
  try { await fs.rm(snapshotPath(identity, globalConfig), { force: true }); } catch {}
}
