/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { ToolMessage } from "@langchain/core/messages";
import { appendAttachmentMetasToRuntimeAndTurn } from "../../../attach/index.js";
import { TOOL_RESULT_TRACE_TRUNCATE_LENGTH } from "../constants.js";

export function createStateCommitter({
  messages = null,
  traces = null,
  turnMessageStore = null,
  dialogProcessId = "",
  runtime = {},
} = {}) {
  return {
    pushAssistantMessage({
      content = "",
      rawModelContent = null,
      modelAdditionalKwargs = null,
      modelResponseMetadata = null,
      type = "message",
      toolCalls = [],
      modelAlias = "",
      modelName = "",
    } = {}) {
      if (!turnMessageStore?.push) return;
      turnMessageStore.push({
        role: "assistant",
        content: String(content || ""),
        type,
        dialogProcessId,
        tool_calls: Array.isArray(toolCalls) ? toolCalls : [],
        modelAlias: String(modelAlias || "").trim(),
        modelName: String(modelName || "").trim(),
        rawModelContent:
          typeof rawModelContent === "string" || Array.isArray(rawModelContent)
            ? rawModelContent
            : null,
        modelAdditionalKwargs:
          modelAdditionalKwargs &&
          typeof modelAdditionalKwargs === "object" &&
          !Array.isArray(modelAdditionalKwargs)
            ? modelAdditionalKwargs
            : null,
        modelResponseMetadata:
          modelResponseMetadata &&
          typeof modelResponseMetadata === "object" &&
          !Array.isArray(modelResponseMetadata)
            ? modelResponseMetadata
            : null,
      });
    },
    pushToolResult({ call = {}, toolResultText = "" } = {}) {
      if (Array.isArray(traces)) {
        traces.push({
          tool: call?.name,
          args: call?.args || {},
          result: String(toolResultText || "").slice(0, TOOL_RESULT_TRACE_TRUNCATE_LENGTH),
        });
      }
      if (Array.isArray(messages)) {
        messages.push(
          new ToolMessage({
            tool_call_id: call?.id,
            content: String(toolResultText || ""),
          }),
        );
      }
      if (turnMessageStore?.push) {
        turnMessageStore.push({
          role: "tool",
          content: String(toolResultText || ""),
          type: "tool_result",
          dialogProcessId,
          tool_call_id: call?.id || "",
          toolName: String(call?.name || "").trim(),
        });
      }
    },
    appendAttachmentMetas(attachmentMetas = []) {
      if (!Array.isArray(attachmentMetas) || !attachmentMetas.length) return;
      appendAttachmentMetasToRuntimeAndTurn({
        runtime,
        turnMessageStore,
        attachmentMetas,
      });
    },
  };
}
