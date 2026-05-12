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
  const resolveCallId = (call = {}) =>
    String(
      call?.id ??
        call?.tool_call_id ??
        call?.toolCallId ??
        call?.call_id ??
        "",
    ).trim();

  const resolveCallName = (call = {}) =>
    String(call?.name ?? call?.tool_name ?? call?.toolName ?? "").trim();

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
      const resolvedCallId = resolveCallId(call);
      const resolvedCallName = resolveCallName(call);
      if (Array.isArray(traces)) {
        traces.push({
          tool: resolvedCallName,
          args: call?.args || {},
          result: String(toolResultText || "").slice(0, TOOL_RESULT_TRACE_TRUNCATE_LENGTH),
        });
      }
      if (Array.isArray(messages)) {
        messages.push(
          new ToolMessage({
            tool_call_id: resolvedCallId,
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
          tool_call_id: resolvedCallId,
          toolName: resolvedCallName,
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
