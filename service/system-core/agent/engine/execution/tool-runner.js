/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { emitEvent } from "../../../event/index.js";
import { isFatalError } from "../../../error/index.js";
import { extractAttachmentMetasFromToolResult } from "../media/artifact-service.js";
import { isAbortError } from "../utils/error-utils.js";

function parseJsonObjectSafely(input = "") {
  const text = String(input || "").trim();
  if (!text) return null;
  try {
    const parsed = JSON.parse(text);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed;
    }
  } catch {}
  return null;
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
} = {}) {
  let toolResultText = "";
  let invokeError = null;
  if (!tool) {
    toolResultText = `tool not found: ${call?.name}`;
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
    if (isAbortError(error)) throw error;
    if (isFatalError(error)) throw error;
    invokeError = error;
    toolResultText = `tool invoke error: ${error?.message || String(error)}`;
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
