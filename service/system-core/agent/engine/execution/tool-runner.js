/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { emitEvent } from "../../../event/index.js";
import { isFatalError } from "../../../error/index.js";
import { extractAttachmentMetasFromToolResult } from "../media/artifact-service.js";
import { isAbortError } from "../utils/error-utils.js";

export async function executeToolCall({
  call = {},
  tool = null,
  abortSignal = null,
  eventListener = null,
  turn = 1,
} = {}) {
  let toolResultText = "";
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
    };
  }
  try {
    const result = await tool.invoke(call?.args || {}, {
      signal: abortSignal,
    });
    toolResultText =
      typeof result === "string" ? result : JSON.stringify(result);
  } catch (error) {
    if (isAbortError(error)) throw error;
    if (isFatalError(error)) throw error;
    toolResultText = `tool invoke error: ${error?.message || String(error)}`;
  }
  emitEvent(eventListener, "tool_call_end", {
    turn,
    tool: call?.name,
    result: String(toolResultText).slice(0, 200),
  });
  return {
    call,
    toolResultText,
    extractedAttachmentMetas: extractAttachmentMetasFromToolResult(
      call?.name,
      toolResultText,
    ),
  };
}
