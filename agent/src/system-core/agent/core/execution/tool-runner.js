/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { emitEvent } from "../../../event/index.js";
import { isFatalError } from "../../../error/index.js";
import { toToolJsonResult } from "../../../tools/core/tool-json-result.js";
import { extractAttachmentsFromToolResult } from "../media/artifact-service.js";
import { isAbortError } from "../utils/error-utils.js";
import { parseJsonObjectSafely } from "../utils/json-utils.js";
import { handleEngineError } from "../error/index.js";
import { ERROR_CODE } from "../../../error/constants.js";
import { AGENT_HOOK_POINTS, runAgentRuntimeHook } from "../../../hook/index.js";
import { buildHookContext } from "../hook/hook-context-builder.js";
import { normalizeParentSessionId } from "../../../context/parent-session-id-resolver.js";
import { transferSemanticContent } from "../../../semantic-transfer/transfer/semantic-transfer.js";
import { compactToolResultTextForModel } from "../../../semantic-transfer/core/compact.js";
import { sanitizeToolResultText } from "@noobot/sanitize";

const TOOL_INPUT_TRANSFER_TOOL_NAMES = new Set([
  "write_file",
  "task_summary",
  "execute_script",
  "search",
  "patch_file",
]);

function shouldTransferToolInput(call = {}) {
  return TOOL_INPUT_TRANSFER_TOOL_NAMES.has(String(call?.name || "").trim());
}

function mergeToolInputTransferPayload(toolResultText = "", transferPayload = {}) {
  const normalizedTransferPayload =
    transferPayload && typeof transferPayload === "object" && !Array.isArray(transferPayload)
      ? transferPayload
      : {};
  if (!Object.keys(normalizedTransferPayload).length) return String(toolResultText || "");
  const parsed = parseJsonObjectSafely(toolResultText);
  if (!parsed) return String(toolResultText || "");
  return JSON.stringify({
    ...parsed,
    ...normalizedTransferPayload,
  });
}

function mergeTaskSummaryTransferPayload(toolResultText = "", transferPayload = {}) {
  const normalizedTransferPayload =
    transferPayload && typeof transferPayload === "object" && !Array.isArray(transferPayload)
      ? transferPayload
      : {};
  if (!Object.keys(normalizedTransferPayload).length) return String(toolResultText || "");
  const parsed = parseJsonObjectSafely(toolResultText);
  if (!parsed) return String(toolResultText || "");
  return JSON.stringify({
    toolName: parsed.toolName || "task_summary",
    ok: parsed.ok !== false,
    status: parsed.status,
    message: parsed.message,
    summarizedMessages: parsed.summarizedMessages,
    ...normalizedTransferPayload,
  });
}

function mergeToolResultWithInputTransferPayload(toolResultText = "", transferPayload = {}, toolName = "") {
  if (String(toolName || "").trim() === "task_summary") {
    return mergeTaskSummaryTransferPayload(toolResultText, transferPayload);
  }
  return mergeToolInputTransferPayload(toolResultText, transferPayload);
}

function compactSemanticTransferProtocolPayload(inputTransfer = {}) {
  if (!inputTransfer || typeof inputTransfer !== "object" || Array.isArray(inputTransfer)) return {};
  const transferEnvelopes = Array.isArray(inputTransfer.transferEnvelopes)
    ? inputTransfer.transferEnvelopes
    : [];
  return {
    ...(transferEnvelopes.length ? { transferEnvelopes } : {}),
  };
}

function deriveToolInputTransferMeta(inputTransfer = {}) {
  const transferEnvelopes = Array.isArray(inputTransfer?.transferEnvelopes)
    ? inputTransfer.transferEnvelopes
    : [];
  const metas = transferEnvelopes
    .map((envelope = {}) => envelope?.meta)
    .filter((meta = null) => meta && typeof meta === "object" && !Array.isArray(meta));
  const overflowMeta = metas.find((meta = {}) => meta?.toolInputOverflow);
  const exceededMeta = metas.find((meta = {}) => meta?.exceeded === true);
  const messageMeta = metas.find((meta = {}) => String(meta?.message || "").trim());
  const sourceMeta = overflowMeta || exceededMeta || messageMeta || metas[0] || {};
  const toolInputOverflow =
    sourceMeta?.toolInputOverflow &&
    typeof sourceMeta.toolInputOverflow === "object" &&
    !Array.isArray(sourceMeta.toolInputOverflow)
      ? sourceMeta.toolInputOverflow
      : null;
  return {
    exceeded: sourceMeta?.exceeded === true || toolInputOverflow?.exceeded === true,
    message: String(sourceMeta?.message || toolInputOverflow?.message || "").trim(),
    toolInputOverflow,
  };
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
      extractedAttachments: [],
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
  let toolInputTransferPayload = {};
  if (shouldTransferToolInput(call)) {
    try {
      const inputTransfer = await transferSemanticContent({
        scenario: "tool",
        strategy: "tool_input",
        call,
        runtime,
        agentContext,
        sessionId,
      });
      const inputTransferMeta = deriveToolInputTransferMeta(inputTransfer);
      toolInputTransferPayload = compactSemanticTransferProtocolPayload(inputTransfer);
      if (
        inputTransferMeta.exceeded === true &&
        inputTransferMeta.toolInputOverflow &&
        typeof inputTransferMeta.toolInputOverflow === "object" &&
        !Array.isArray(inputTransferMeta.toolInputOverflow)
      ) {
        toolResultText = toToolJsonResult(call?.name, {
          ok: false,
          message: inputTransferMeta.message || "tool input is too long",
          toolInputOverflow: inputTransferMeta.toolInputOverflow,
          ...toolInputTransferPayload,
        });
        toolResultText = compactToolResultTextForModel(toolResultText);
        emitEvent(eventListener, "tool_call_end", {
          turn,
          tool: call?.name,
          result: String(toolResultText).slice(0, 200),
          success: true,
        });
        await runAgentRuntimeHook({
          runtime,
          point: AGENT_HOOK_POINTS.AFTER_TOOL_CALL,
          context: buildHookContext(AGENT_HOOK_POINTS.AFTER_TOOL_CALL, runtime, {
            phase: "tool_call",
            executionScope,
            turn,
            status: "success",
            startedAt: toolStartedAt,
            endedAt: new Date(Date.now()).toISOString(),
            durationMs: Date.now() - toolStartedAtMs,
            call,
            toolName: call?.name || "",
            args: call?.args || {},
            success: true,
            failureReason: "",
            toolResultText,
            agentContext,
          }),
        });
        return {
          call,
          toolResultText,
          extractedAttachments: [],
          success: true,
          failureReason: "",
        };
      }
    } catch {
      toolInputTransferPayload = {};
    }
  }
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
    toolResultText = mergeToolResultWithInputTransferPayload(
      toolResultText,
      toolInputTransferPayload,
      call?.name,
    );
    rawToolResultText = toolResultText;
    if (runtime?.systemRuntime?.config?.sanitizeOutput !== false) {
      toolResultText = await sanitizeToolResultText(toolResultText);
    }
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
    if (runtime?.systemRuntime?.config?.sanitizeOutput !== false) {
      toolResultText = await sanitizeToolResultText(toolResultText);
    }
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
  const rawExtractedAttachments = extractAttachmentsFromToolResult(
    call?.name,
    rawToolResultText || toolResultText,
  );
  const overflowNormalized = await transferSemanticContent({
    scenario: "tool",
    strategy: "tool_result_text",
    call,
    toolResultText,
    runtime,
    agentContext,
    sessionId,
  });
  toolResultText = overflowNormalized.toolResultText;
  if (String(call?.name || "").trim() === "task_summary") {
    toolResultText = mergeTaskSummaryTransferPayload(toolResultText, toolInputTransferPayload);
  }
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
  const normalizedExtractedAttachments = extractAttachmentsFromToolResult(
    call?.name,
    toolResultText,
  );
  return {
    call,
    toolResultText,
    extractedAttachments: normalizedExtractedAttachments.length
      ? normalizedExtractedAttachments
      : rawExtractedAttachments,
    success: failureState.success,
    failureReason: failureState.reason,
  };
}
