/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { HOOK_POINT } from "@noobot/hook-protocol";
import crypto from "node:crypto";
import { LENGTH_THRESHOLDS } from "@noobot/shared/length-thresholds";
import { text } from "@noobot/shared/value";

function stableStringify(value) {
  try {
    return JSON.stringify(value, Object.keys(value || {}).sort());
  } catch {
    return JSON.stringify(value);
  }
}

export function sha256Text(inputText = "") {
  return crypto
    .createHash("sha256")
    .update(String(inputText || ""))
    .digest("hex");
}

export function nowIso() {
  return new Date().toISOString();
}

export function safeId(value = "") {
  const normalizedText = text(value);
  return normalizedText.replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 160);
}

export function safeError(error) {
  if (!error) return null;
  return {
    name: String(error?.name || "Error"),
    message: String(error?.message || error),
    code: error?.code ? String(error.code) : undefined,
  };
}

export function preview(value, maxChars = LENGTH_THRESHOLDS.display.harnessPreviewChars) {
  if (value == null) return "";
  const inputText = typeof value === "string" ? value : JSON.stringify(value);
  return String(inputText || "").slice(0, Math.max(0, Number(maxChars) || 0));
}

function buildPayloadPreview(point, ctx = {}, options = {}) {
  const maxPreviewChars = options.maxPreviewChars || LENGTH_THRESHOLDS.display.harnessPreviewChars;
  if (point === HOOK_POINT.AGENT.BEFORE_LLM_CALL || point === HOOK_POINT.AGENT.AFTER_LLM_CALL) {
    return {
      messageCount: Array.isArray(ctx?.modelContext?.messages)
        ? ctx.modelContext.messages.length
        : undefined,
      toolChoice: ctx.toolChoice,
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

export function buildEvent({ point, ctx = {}, options = {} } = {}) {
  const capabilityLogs = Array.isArray(ctx?.harnessCapabilityLogs) ? ctx.harnessCapabilityLogs : [];
  const toolTurnLimitReached = resolveToolTurnLimitReached(capabilityLogs);
  return {
    kind: "hook",
    eventId: crypto.randomUUID(),
    point,
    phase: ctx.phase || undefined,
    status: ctx.status || undefined,
    timestamp: nowIso(),
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

export function buildContextSnapshot({ ctx, pluginName, pluginVersion }) {
  const { context, bindings } = ctx.agentContext;
  const { identity, environment, execution, modelContext } = context;
  return {
    plugin: pluginName,
    version: pluginVersion,
    createdAt: nowIso(),
    userId: identity.userId,
    sessionId: identity.sessionId,
    parentSessionId: identity.parentSessionId,
    dialogProcessId: identity.dialogProcessId,
    caller: execution.caller,
    environment: {
      os: environment.os,
      workspace: environment.workspace,
    },
    execution: {
      flags: execution.flags,
      runtimeModel: execution.model.runtimeModel,
    },
    session: {
      attachmentCount: bindings.runtime.userMessageAttachments.length,
      connectorIds: execution.selectedConnectorIds,
    },
    payload: {
      systemMessageCount: modelContext.messageBlocks.system.length,
      historyMessageCount: modelContext.messageBlocks.history.length,
    },
  };
}

export function buildPromptRecord({
  promptId = "",
  point = "",
  content = "",
  maxPreviewChars = LENGTH_THRESHOLDS.display.harnessPreviewChars,
} = {}) {
  return {
    promptId,
    point,
    timestamp: nowIso(),
    contentHash: sha256Text(content),
    contentPreview: preview(content, maxPreviewChars),
  };
}
