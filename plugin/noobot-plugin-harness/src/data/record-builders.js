/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import crypto from "node:crypto";

function stableStringify(value) {
  try {
    return JSON.stringify(value, Object.keys(value || {}).sort());
  } catch {
    return JSON.stringify(value);
  }
}

export function sha256Text(text = "") {
  return crypto.createHash("sha256").update(String(text || "")).digest("hex");
}

export function nowIso() {
  return new Date().toISOString();
}

export function safeId(value = "") {
  const text = String(value || "").trim();
  return text.replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 160);
}

export function safeError(error) {
  if (!error) return null;
  return {
    name: String(error?.name || "Error"),
    message: String(error?.message || error),
    code: error?.code ? String(error.code) : undefined,
  };
}

export function preview(value, maxChars = 1200) {
  if (value == null) return "";
  const text = typeof value === "string" ? value : JSON.stringify(value);
  return String(text || "").slice(0, Math.max(0, Number(maxChars) || 0));
}

function buildPayloadPreview(point, ctx = {}, options = {}) {
  const maxPreviewChars = options.maxPreviewChars || 1200;
  if (point === "before_llm_call" || point === "after_llm_call") {
    return {
      messageCount: Array.isArray(ctx.messages) ? ctx.messages.length : undefined,
      toolChoice: ctx.toolChoice,
      hasToolCalls: ctx.hasToolCalls,
      callCount: Array.isArray(ctx.calls) ? ctx.calls.length : undefined,
    };
  }
  if (point.includes("tool_call")) {
    return {
      callId: ctx.call?.id,
      argsHash: ctx.args ? sha256Text(stableStringify(ctx.args)) : undefined,
      resultPreview: ctx.toolResultText ? preview(ctx.toolResultText, maxPreviewChars) : undefined,
      resultSize: ctx.toolResultText ? String(ctx.toolResultText).length : undefined,
    };
  }
  if (point.includes("state_commit")) {
    return {
      commitType: ctx.commitType,
      payloadPreview: preview(ctx.payload, maxPreviewChars),
    };
  }
  return undefined;
}

function extractRuntime(ctx = {}) {
  return ctx?.agentContext?.execution?.controllers?.runtime || null;
}

function resolveToolTurnLimitReached(capabilityLogs = []) {
  const logs = Array.isArray(capabilityLogs) ? capabilityLogs : [];
  return logs.some(
    (log) =>
      log?.event === "capability_model_trace" &&
      (log?.detail?.toolTurnLimitReached === true ||
        (Array.isArray(log?.detail?.traces) &&
          log.detail.traces.some((trace) => trace?.toolTurnLimitReached === true))),
  );
}

export function buildEvent({ point, ctx = {}, options = {}, pluginName = "", pluginVersion = "" } = {}) {
  const capabilityLogs = Array.isArray(ctx?.harnessCapabilityLogs)
    ? ctx.harnessCapabilityLogs
    : [];
  const toolTurnLimitReached = resolveToolTurnLimitReached(capabilityLogs);
  return {
    eventId: crypto.randomUUID(),
    plugin: pluginName,
    version: pluginVersion,
    point,
    phase: ctx.phase || undefined,
    status: ctx.status || undefined,
    timestamp: nowIso(),
    userId: ctx.userId || undefined,
    sessionId: ctx.sessionId || undefined,
    parentSessionId: ctx.parentSessionId || undefined,
    dialogProcessId: ctx.dialogProcessId || ctx?.agentContext?.execution?.dialogProcessId || undefined,
    caller: ctx.caller || undefined,
    turn: ctx.turn,
    mode: ctx.mode,
    toolName: ctx.toolName,
    commitType: ctx.commitType,
    durationMs: Number.isFinite(ctx.durationMs) ? ctx.durationMs : undefined,
    success: typeof ctx.success === "boolean" ? ctx.success : undefined,
    failureReason: ctx.failureReason || undefined,
    error: safeError(ctx.error),
    preview: buildPayloadPreview(point, ctx, options),
    toolTurnLimitReached: toolTurnLimitReached === true ? true : undefined,
    capabilityLogs: capabilityLogs.length ? capabilityLogs : undefined,
  };
}

export function buildContextSnapshot({ ctx = {}, pluginName = "", pluginVersion = "" } = {}) {
  const agentContext = ctx.agentContext || {};
  const runtime = extractRuntime(ctx) || {};
  const systemRuntime = runtime.systemRuntime || {};
  return {
    plugin: pluginName,
    version: pluginVersion,
    createdAt: nowIso(),
    userId: ctx.userId || runtime.userId || agentContext?.environment?.identity?.userId || "",
    sessionId: ctx.sessionId || systemRuntime.sessionId || agentContext?.session?.current?.id || "",
    parentSessionId: ctx.parentSessionId || systemRuntime.parentSessionId || agentContext?.session?.parent?.id || "",
    dialogProcessId: ctx.dialogProcessId || systemRuntime.dialogProcessId || agentContext?.execution?.dialogProcessId || "",
    caller: ctx.caller || systemRuntime.caller || agentContext?.session?.parent?.caller || "",
    environment: {
      os: agentContext?.environment?.os || {},
      workspace: agentContext?.environment?.workspace || {},
    },
    execution: {
      flags: agentContext?.execution?.flags || {},
      runtimeModel: agentContext?.execution?.models?.runtimeModel || runtime.runtimeModel || "",
    },
    session: {
      attachmentCount: Array.isArray(agentContext?.session?.current?.attachments)
        ? agentContext.session.current.attachments.length
        : 0,
      connectors: agentContext?.session?.current?.connectors || {},
    },
    payload: {
      systemMessageCount: Array.isArray(agentContext?.payload?.messages?.system)
        ? agentContext.payload.messages.system.length
        : 0,
      historyMessageCount: Array.isArray(agentContext?.payload?.messages?.history)
        ? agentContext.payload.messages.history.length
        : 0,
    },
  };
}

export function buildPromptRecord({ promptId = "", point = "", content = "", maxPreviewChars = 1200 } = {}) {
  return {
    promptId,
    point,
    timestamp: nowIso(),
    contentHash: sha256Text(content),
    contentPreview: preview(content, maxPreviewChars),
  };
}
