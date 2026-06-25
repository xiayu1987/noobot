/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import crypto from "node:crypto";
import { emitEvent } from "../../../event/index.js";

const DEFAULT_PREVIEW_LIMIT = 40;
const DEFAULT_CONTENT_CHARS = 120;

function parseTraceToggle(value) {
  if (value === true || value === false) return value;
  const text = String(value ?? "").trim().toLowerCase();
  if (!text) return undefined;
  if (["1", "true", "on", "yes", "enable", "enabled"].includes(text)) return true;
  if (["0", "false", "off", "no", "disable", "disabled"].includes(text)) return false;
  return undefined;
}

function readTraceToggleFromArgv(argv = process.argv) {
  const args = Array.isArray(argv) ? argv : [];
  for (let index = 0; index < args.length; index += 1) {
    const arg = String(args[index] || "").trim();
    if (!arg) continue;
    if (arg === "--no-model-context-trace" || arg === "--no-noobot-model-context-trace") {
      return false;
    }
    const matched = arg.match(/^--(?:noobot-)?model-context-trace(?:=(.*))?$/);
    if (!matched) continue;
    if (matched[1] === undefined) {
      const next = String(args[index + 1] || "").trim();
      const nextToggle = next && !next.startsWith("--") ? parseTraceToggle(next) : undefined;
      return nextToggle ?? true;
    }
    return parseTraceToggle(matched[1]) ?? true;
  }
  return undefined;
}

export function isModelContextTraceEnabled(runtime = {}) {
  const explicit = parseTraceToggle(runtime?.systemRuntime?.modelContextTrace ?? runtime?.modelContextTrace);
  if (explicit !== undefined) return explicit;
  const argvToggle = readTraceToggleFromArgv();
  if (argvToggle !== undefined) return argvToggle;
  return true;
}

function textHash(text = "") {
  return crypto.createHash("sha256").update(String(text || "")).digest("hex").slice(0, 16);
}

function readField(message = {}, field = "") {
  const key = String(field || "").trim();
  if (!key || !message || typeof message !== "object") return "";
  return String(
    message?.[key] ??
      message?.additional_kwargs?.[key] ??
      message?.lc_kwargs?.[key] ??
      message?.lc_kwargs?.additional_kwargs?.[key] ??
      "",
  ).trim();
}

function resolveDiagnosticMessageId(message = {}) {
  return readField(message, "noobotMessageId") || readField(message, "messageId") || undefined;
}

export function resolveDiagnosticRole(message = {}) {
  const role = String(message?.role || message?.lc_kwargs?.role || "").trim().toLowerCase();
  if (role) return role;
  const type = String(
    message?.type ||
      message?.lc_kwargs?.type ||
      (typeof message?._getType === "function" ? message._getType() : ""),
  ).trim().toLowerCase();
  if (type === "ai") return "assistant";
  if (type === "human") return "user";
  return type;
}

function resolveContent(message = {}) {
  const content = message?.content ?? message?.lc_kwargs?.content ?? "";
  if (typeof content === "string") return content;
  try {
    return JSON.stringify(content);
  } catch {
    return String(content ?? "");
  }
}

function messageTraceItem(message = {}, index = 0, block = "") {
  const content = resolveContent(message);
  const preview = content.replace(/\s+/g, " ").slice(0, DEFAULT_CONTENT_CHARS);
  return {
    index,
    ...(block ? { block } : {}),
    role: resolveDiagnosticRole(message),
    messageId: resolveDiagnosticMessageId(message),
    type: String(message?.type || message?.lc_kwargs?.type || "").trim() || undefined,
    dialogProcessId: readField(message, "dialogProcessId") || undefined,
    turnScopeId: readField(message, "turnScopeId") || undefined,
    injectedMessageType: readField(message, "injectedMessageType") || readField(message, "injected_message_type") || undefined,
    internalType: readField(message, "noobotInternalMessageType") || undefined,
    summarized: message?.summarized === true || message?.lc_kwargs?.summarized === true || message?.additional_kwargs?.summarized === true || undefined,
    contentHash: textHash(content),
    contentPreview: preview,
  };
}

export function summarizeDiagnosticMessages(messages = [], { limit = DEFAULT_PREVIEW_LIMIT, block = "" } = {}) {
  const source = Array.isArray(messages) ? messages : [];
  return {
    count: source.length,
    roles: source.map((message) => resolveDiagnosticRole(message)).filter(Boolean),
    preview: source.slice(0, Math.max(0, Number(limit) || 0)).map((message, index) =>
      messageTraceItem(message, index, block),
    ),
    truncated: source.length > Math.max(0, Number(limit) || 0) ? source.length - Math.max(0, Number(limit) || 0) : 0,
  };
}

export function summarizeDiagnosticBlocks(blocks = null, { limit = DEFAULT_PREVIEW_LIMIT } = {}) {
  const safeBlocks = blocks && typeof blocks === "object" && !Array.isArray(blocks) ? blocks : {};
  return {
    system: summarizeDiagnosticMessages(safeBlocks.system, { limit, block: "system" }),
    history: summarizeDiagnosticMessages(safeBlocks.history, { limit, block: "history" }),
    incremental: summarizeDiagnosticMessages(safeBlocks.incremental, { limit, block: "incremental" }),
  };
}

export function emitModelContextTrace(runtimeOrListener = null, stage = "", payload = {}) {
  const runtime = runtimeOrListener && typeof runtimeOrListener === "object" && !runtimeOrListener.onEvent
    ? runtimeOrListener
    : {};
  const listener = runtime?.eventListener || (runtimeOrListener?.onEvent ? runtimeOrListener : null);
  if (!isModelContextTraceEnabled(runtime)) return false;
  emitEvent(listener, "model_context_trace", {
    stage: String(stage || "unknown").trim() || "unknown",
    ...payload,
  });
  return true;
}
