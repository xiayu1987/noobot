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
  errorLogger = null,
  userId = "",
  sessionId = "",
  parentSessionId = "",
} = {}) {
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
    return {
      call,
      toolResultText,
      extractedAttachmentMetas: [],
      success: false,
      failureReason: "tool_not_found",
    };
  }
  let rawResult = null;
  try {
    rawResult = await tool.invoke(call?.args || {}, {
      signal: abortSignal,
    });
    toolResultText =
      typeof rawResult === "string" ? rawResult : JSON.stringify(rawResult);
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
    if (errorLogger && typeof errorLogger.log === "function") {
      void errorLogger.log({
        userId,
        sessionId,
        parentSessionId,
        source: "tool-runner",
        event: "tool_invoke_error",
        error,
        extra: { toolName: call?.name || "" },
      });
    }
  }
  const failureState = detectToolCallFailure({
    rawResult,
    toolResultText,
    invokeError,
  });
  emitEvent(eventListener, "tool_call_end", {
    turn,
    tool: call?.name,
    result: String(toolResultText).slice(0, 200),
    success: failureState.success,
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
