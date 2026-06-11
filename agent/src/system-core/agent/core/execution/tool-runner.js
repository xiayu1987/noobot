/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
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
import { normalizeParentSessionId } from "../../../context/parent-session-id-resolver.js";
import { transferSemanticContent } from "../../../semantic-transfer/index.js";

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
        parentSessionId: normalizeParentSessionId(parentSessionId),
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
  const rawExtractedAttachmentMetas = extractAttachmentMetasFromToolResult(
    call?.name,
    rawToolResultText || toolResultText,
  );
  const overflowNormalized = await transferSemanticContent({
    scenario: "tool",
    transferMode: "tool_result_text",
    call,
    toolResultText,
    runtime,
    agentContext,
    sessionId,
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
  const normalizedExtractedAttachmentMetas = extractAttachmentMetasFromToolResult(
    call?.name,
    toolResultText,
  );
  return {
    call,
    toolResultText,
    extractedAttachmentMetas: normalizedExtractedAttachmentMetas.length
      ? normalizedExtractedAttachmentMetas
      : rawExtractedAttachmentMetas,
    success: failureState.success,
    failureReason: failureState.reason,
  };
}
