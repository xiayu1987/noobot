/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { mkdir, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { emitEvent } from "../../../event/index.js";
import { isFatalError } from "../../../error/index.js";
import { toToolJsonResult } from "../../../tools/core/tool-json-result.js";
import { extractAttachmentMetasFromToolResult } from "../media/artifact-service.js";
import { isAbortError } from "../utils/error-utils.js";
import { parseJsonObjectSafely } from "../utils/json-utils.js";
import { handleEngineError } from "../error/index.js";
import { ERROR_CODE } from "../../../error/constants.js";
import { AGENT_HOOK_POINTS, runAgentRuntimeHook } from "../../../hook/index.js";
import { buildHookContext } from "../hook/hook-context-builder.js";
import { resolveSandboxPath as resolveSandboxPathByAgent } from "../../../utils/sandbox-path-resolver.js";

const DEFAULT_MAX_TOOL_RESULT_CHARS = 10000;

function toSafePositiveInt(value, fallback = DEFAULT_MAX_TOOL_RESULT_CHARS, min = 512) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return Math.max(min, Number(fallback || 0));
  return Math.max(min, Math.floor(parsed));
}

function resolveToolResultLengthLimit(runtime = {}) {
  const userLimit = runtime?.userConfig?.tools?.maxToolResultChars;
  const globalLimit = runtime?.globalConfig?.tools?.maxToolResultChars;
  return toSafePositiveInt(userLimit ?? globalLimit, DEFAULT_MAX_TOOL_RESULT_CHARS, 512);
}

function resolveOverflowSandboxFilePath({
  overflowPath = "",
  runtime = {},
  agentContext = null,
} = {}) {
  const pathResolverCandidates = [
    runtime?.sharedTools?.resolveSandboxPath,
    runtime?.sharedTools?.toSandboxPath,
    runtime?.sharedTools?.pathMapper?.toSandboxPath,
  ];
  for (const resolver of pathResolverCandidates) {
    if (typeof resolver !== "function") continue;
    try {
      const resolved = String(
        resolver({
          path: overflowPath,
          hostPath: overflowPath,
          runtime,
          agentContext,
          purpose: "tool_result_overflow",
        }) || "",
      ).trim();
      if (resolved) return resolved;
    } catch {
      // Fallback to agent shared resolver below.
    }
  }
  return String(
    resolveSandboxPathByAgent({
      path: overflowPath,
      hostPath: overflowPath,
      runtime,
      agentContext,
    }) || "",
  ).trim();
}

function resolveOverflowOutputDir({ runtime = {}, agentContext = null } = {}) {
  const basePath = String(
    agentContext?.environment?.workspace?.basePath || runtime?.basePath || "",
  ).trim();
  if (basePath) {
    return path.join(basePath, "runtime", "ops_workdir", ".tool-result-overflow");
  }
  return path.join(os.tmpdir(), "noobot-tool-result-overflow");
}

async function persistToolResultOverflow({
  call = {},
  toolResultText = "",
  maxChars = DEFAULT_MAX_TOOL_RESULT_CHARS,
  runtime = {},
  agentContext = null,
} = {}) {
  const outputDir = resolveOverflowOutputDir({ runtime, agentContext });
  await mkdir(outputDir, { recursive: true });
  const outputPath = path.join(outputDir, `${Date.now()}-${randomUUID()}.json`);
  const payload = {
    toolName: String(call?.name || "").trim(),
    toolCallId: String(call?.id || "").trim(),
    createdAt: new Date().toISOString(),
    originalLength: String(toolResultText || "").length,
    maxChars: Number(maxChars || DEFAULT_MAX_TOOL_RESULT_CHARS),
    result: String(toolResultText || ""),
  };
  await writeFile(outputPath, JSON.stringify(payload, null, 2), "utf8");
  return outputPath;
}

async function normalizeToolResultOverflow({
  call = {},
  toolResultText = "",
  runtime = {},
  agentContext = null,
} = {}) {
  const rawText = String(toolResultText || "");
  const maxChars = resolveToolResultLengthLimit(runtime);
  if (rawText.length <= maxChars) {
    return { toolResultText: rawText, overflowed: false };
  }

  const overflowPath = await persistToolResultOverflow({
    call,
    toolResultText: rawText,
    maxChars,
    runtime,
    agentContext,
  });
  const overflowSandboxPath = resolveOverflowSandboxFilePath({
    overflowPath,
    runtime,
    agentContext,
  });
  const parsed = parseJsonObjectSafely(rawText);
  const ok = parsed && typeof parsed.ok === "boolean" ? parsed.ok : true;
  const status = String(parsed?.status || "").trim();
  const originalMessage = String(parsed?.message || "").trim();
  const normalized = toToolJsonResult(call?.name, {
    ok,
    ...(status ? { status } : {}),
    ...(ok ? {} : { error: String(parsed?.error || "").trim() || "tool result overflowed" }),
    message:
      originalMessage ||
      `工具返回内容过长(${rawText.length}字符)，已保存到文件，请按路径分批读取。`,
    overflowed: true,
    overflow_reason: `tool result length ${rawText.length} exceeds limit ${maxChars}`,
    overflow_file_path: overflowPath,
    ...(overflowSandboxPath ? { overflow_file_sandbox_path: overflowSandboxPath } : {}),
    summary: {
      original_length: rawText.length,
      max_length: maxChars,
    },
  });
  return { toolResultText: normalized, overflowed: true };
}

function resolveToolHookMeta(runtime = {}) {
  const runtimeMeta =
    runtime?.hookManager?.runtime && typeof runtime.hookManager.runtime === "object"
      ? runtime.hookManager.runtime
      : null;
  if (runtimeMeta) {
    return {
      ...runtimeMeta,
      runtime,
    };
  }
  return { runtime };
}

function detectToolCallFailure({ rawResult, toolResultText = "", invokeError = null }) {
  if (invokeError) {
    return { success: false, reason: "invoke_error" };
  }
  if (rawResult && typeof rawResult === "object" && !Array.isArray(rawResult)) {
    if (rawResult.ok === false) return { success: false, reason: "result_ok_false" };
    return { success: true, reason: "" };
  }
  const parsed = parseJsonObjectSafely(toolResultText);
  if (parsed && parsed.ok === false) {
    return { success: false, reason: "result_ok_false" };
  }
  return { success: true, reason: "" };
}

export async function executeToolCall({
  call = {},
  tool = null,
  abortSignal = null,
  eventListener = null,
  turn = 1,
  executionScope = "primary",
  errorLogger = null,
  userId = "",
  sessionId = "",
  parentSessionId = "",
  runtime = {},
  agentContext = null,
} = {}) {
  const toolStartedAtMs = Date.now();
  const toolStartedAt = new Date(toolStartedAtMs).toISOString();
  let toolResultText = "";
  let invokeError = null;
  if (!tool) {
    toolResultText = toToolJsonResult(call?.name, {
      ok: false,
      status: "failed",
      code: ERROR_CODE.RECOVERABLE_TOOL_NOT_FOUND,
      error: `tool not found: ${call?.name}`,
    });
    emitEvent(eventListener, "tool_call_end", {
      turn,
      tool: call?.name,
      result: String(toolResultText).slice(0, 200),
    });
    await runAgentRuntimeHook({
      runtime,
      point: AGENT_HOOK_POINTS.AFTER_TOOL_CALL,
      context: buildHookContext(AGENT_HOOK_POINTS.AFTER_TOOL_CALL, runtime, {
        phase: "tool_call",
        executionScope,
        turn,
        status: "error",
        startedAt: toolStartedAt,
        endedAt: new Date(Date.now()).toISOString(),
        durationMs: Date.now() - toolStartedAtMs,
        call,
        toolName: call?.name || "",
        success: false,
        failureReason: "tool_not_found",
        toolResultText,
        agentContext,
      }),
    });
    return {
      call,
      toolResultText,
      extractedAttachmentMetas: [],
      success: false,
      failureReason: "tool_not_found",
    };
  }
  let rawResult = null;
  let rawToolResultText = "";
  await runAgentRuntimeHook({
    runtime,
    point: AGENT_HOOK_POINTS.BEFORE_TOOL_CALL,
    context: buildHookContext(AGENT_HOOK_POINTS.BEFORE_TOOL_CALL, runtime, {
      phase: "tool_call",
      executionScope,
      turn,
      status: "start",
      startedAt: toolStartedAt,
      call,
      toolName: call?.name || "",
      args: call?.args || {},
      agentContext,
    }),
  });
  try {
    rawResult = await tool.invoke(call?.args || {}, {
      signal: abortSignal,
      configurable: {
        noobotHookContext: buildHookContext(AGENT_HOOK_POINTS.BEFORE_TOOL_CALL, runtime, {
          phase: "tool_call",
          executionScope,
          turn,
          status: "running",
          startedAt: toolStartedAt,
          call,
          toolName: call?.name || "",
          args: call?.args || {},
          agentContext,
        }),
        noobotHookMeta: resolveToolHookMeta(runtime),
      },
    });
    toolResultText =
      typeof rawResult === "string" ? rawResult : JSON.stringify(rawResult);
    rawToolResultText = toolResultText;
  } catch (error) {
    const isAbort = isAbortError(error);
    const isFatal = isFatalError(error);
    handleEngineError({
      error,
      eventListener,
      event: "tool_call_error",
      metadata: {
        source: "tool-runner",
        turn,
        tool: String(call?.name || "").trim(),
        sessionId: String(sessionId || "").trim(),
        parentSessionId: String(parentSessionId || "").trim(),
      },
    });
    if (isAbort || isFatal) throw error;
    await runAgentRuntimeHook({
      runtime,
      point: AGENT_HOOK_POINTS.TOOL_CALL_ERROR,
      context: buildHookContext(AGENT_HOOK_POINTS.TOOL_CALL_ERROR, runtime, {
        phase: "tool_call",
        executionScope,
        turn,
        status: "error",
        startedAt: toolStartedAt,
        endedAt: new Date(Date.now()).toISOString(),
        durationMs: Date.now() - toolStartedAtMs,
        call,
        toolName: call?.name || "",
        args: call?.args || {},
        error,
        agentContext,
      }),
    });
    invokeError = error;
    const errorDetails =
      error?.details && typeof error.details === "object" ? error.details : null;
    toolResultText = toToolJsonResult(call?.name, {
      ok: false,
      status: "failed",
      code: String(error?.code || ERROR_CODE.RECOVERABLE_TOOL_INVOKE_ERROR),
      error: error?.message || String(error),
      ...(errorDetails ? { details: errorDetails } : {}),
    });
    rawToolResultText = toolResultText;
    if (errorLogger && typeof errorLogger.log === "function") {
      const normalizedCause =
        typeof error?.cause === "string"
          ? error.cause
          : error?.cause?.message || "";
      void errorLogger.log({
        userId,
        sessionId,
        parentSessionId,
        source: "tool-runner",
        event: "tool_invoke_error",
        error,
        extra: {
          toolName: call?.name || "",
          ...(normalizedCause ? { cause: normalizedCause } : {}),
        },
      });
    }
  }
  const failureState = detectToolCallFailure({
    rawResult,
    toolResultText: rawToolResultText || toolResultText,
    invokeError,
  });
  const overflowNormalized = await normalizeToolResultOverflow({
    call,
    toolResultText,
    runtime,
    agentContext,
  });
  toolResultText = overflowNormalized.toolResultText;
  emitEvent(eventListener, "tool_call_end", {
    turn,
    tool: call?.name,
    result: String(toolResultText).slice(0, 200),
    success: failureState.success,
  });
  await runAgentRuntimeHook({
    runtime,
    point: AGENT_HOOK_POINTS.AFTER_TOOL_CALL,
    context: buildHookContext(AGENT_HOOK_POINTS.AFTER_TOOL_CALL, runtime, {
      phase: "tool_call",
      executionScope,
      turn,
      status: failureState.success ? "success" : "error",
      startedAt: toolStartedAt,
      endedAt: new Date(Date.now()).toISOString(),
      durationMs: Date.now() - toolStartedAtMs,
      call,
      toolName: call?.name || "",
      args: call?.args || {},
      success: failureState.success,
      failureReason: failureState.reason || "",
      toolResultText,
      agentContext,
    }),
  });
  return {
    call,
    toolResultText,
    extractedAttachmentMetas: extractAttachmentMetasFromToolResult(
      call?.name,
      toolResultText,
    ),
    success: failureState.success,
    failureReason: failureState.reason,
  };
}
