/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import fs from "node:fs/promises";
import { filePath as path } from "../../../utils/path-resolver.js";
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

const LANGCHAIN_SERIALIZATION_KEYS = new Set([
  "lc",
  "id",
  "kwargs",
  "type",
  "lc_namespace",
  "lc_serializable",
  "lc_aliases",
  "lc_attributes",
  "lc_secrets",
]);

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
  const raw = {};
  const serialized = {
    raw,
    type: normalizedType,
    content: typeof message?.content === "string" ? message.content : message?.content ?? "",
    additional_kwargs: cloneJson(rawKwargs) || {},
    lc_kwargs: cloneJson(message?.lc_kwargs) || {},
    summarized: message?.summarized === true || message?.lc_kwargs?.summarized === true || rawKwargs?.summarized === true,
  };
  for (const key of Object.keys(message || {})) {
    if (
      key in serialized
      || ["content", "additional_kwargs", "lc_kwargs"].includes(key)
      || LANGCHAIN_SERIALIZATION_KEYS.has(key)
      || String(key || "").startsWith("lc_")
    ) continue;
    const value = cloneJson(message[key]);
    if (value !== undefined) serialized.raw[key] = value;
  }
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
  let message;
  if (item?.type === "system") message = new SystemMessage(payload);
  else if (item?.type === "ai") message = new AIMessage({
    ...payload,
    tool_calls: cloneJson(item?.tool_calls) || [],
    invalid_tool_calls: cloneJson(item?.invalid_tool_calls) || [],
  });
  else if (item?.type === "tool") message = new ToolMessage({
    ...payload,
    tool_call_id: item?.tool_call_id || "",
    name: item?.name,
    status: item?.status,
    artifact: cloneJson(item?.artifact),
  });
  else message = new HumanMessage(payload);
  const raw = item?.raw && typeof item.raw === "object" ? cloneJson(item.raw) : null;
  if (raw) {
    for (const [key, value] of Object.entries(raw)) {
      if (
        !["content", "additional_kwargs", "tool_calls", "invalid_tool_calls", "tool_call_id"].includes(key)
        && !LANGCHAIN_SERIALIZATION_KEYS.has(key)
        && !String(key || "").startsWith("lc_")
      ) {
        try { message[key] = value; } catch {}
      }
    }
    message.additional_kwargs = { ...(raw.additional_kwargs || {}), ...(message.additional_kwargs || {}) };
    if (raw.lc_kwargs && typeof raw.lc_kwargs === "object") message.lc_kwargs = raw.lc_kwargs;
  }
  if (item?.lc_kwargs && typeof item.lc_kwargs === "object") message.lc_kwargs = cloneJson(item.lc_kwargs);
  if (item?.summarized === true || raw?.summarized === true || raw?.lc_kwargs?.summarized === true) message.summarized = true;
  return message;
}

export function syncStoppedModelMessageSnapshotCandidate(runtime = {}, modelMessages = []) {
  const candidate = runtime?.stoppedModelMessageSnapshotCandidate;
  if (!candidate || !Array.isArray(modelMessages)) return candidate || null;
  // `modelMessages` is the final LLM input projection after
  // filterForModelContext().  It may flatten assistant/tool messages into
  // human text, inject derived user_meta messages and reorder the model input
  // for provider compatibility.  Stopped snapshots must persist the canonical
  // message fact source instead: candidate.messageBlocks is initialized from
  // loopState.messageBlocks and appendMessage() keeps that same block object up
  // to date during the turn.  Never rebuild snapshot history from the projected
  // model input, otherwise a resume->stop lifecycle progressively degrades
  // ai/tool messages into empty human messages and duplicates user_meta.
  return runtime.stoppedModelMessageSnapshotCandidate;
}

function serializeList(list = []) {
  return (Array.isArray(list) ? list : []).map(serializeMessage).filter(Boolean);
}

function composeMessagesFromBlocks(messageBlocks = {}) {
  if (!messageBlocks || typeof messageBlocks !== "object" || Array.isArray(messageBlocks)) return [];
  return [
    ...(Array.isArray(messageBlocks.system) ? messageBlocks.system : []),
    ...(Array.isArray(messageBlocks.history) ? messageBlocks.history : []),
    ...(Array.isArray(messageBlocks.incremental) ? messageBlocks.incremental : []),
  ];
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
  const systemCount = Array.isArray(candidate.messageBlocks?.system) ? candidate.messageBlocks.system.length : 0;
  const historyCount = Array.isArray(candidate.messageBlocks?.history) ? candidate.messageBlocks.history.length : 0;
  const incrementalCount = Array.isArray(candidate.messageBlocks?.incremental) ? candidate.messageBlocks.incremental.length : 0;
  return {
    messageCount: systemCount + historyCount + incrementalCount,
    systemCount,
    historyCount,
    incrementalCount,
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
  const factSourceMessages = composeMessagesFromBlocks(messageBlocks);
  const snapshot = {
    version: 2,
    ...normalizedIdentity,
    createdAt: now,
    updatedAt: now,
    messageBlocks: {
      system: serializeList(messageBlocks.system),
      history: serializeList(messageBlocks.history),
      incremental: serializeList(messageBlocks.incremental),
    },
    messages: serializeList(factSourceMessages),
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
