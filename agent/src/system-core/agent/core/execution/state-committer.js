/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { ToolMessage } from "@langchain/core/messages";
import { appendAttachmentMetasToRuntimeAndTurn } from "../../../attach/index.js";
import { TOOL_RESULT_TRACE_TRUNCATE_LENGTH } from "../constants/index.js";
import { HOOK_POINTS, runRuntimeHook, withHookRuntimeMeta } from "../../../hook/index.js";

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
    async pushAssistantMessage({
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
      const assistantMessage = {
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
      };
      await runRuntimeHook({
        runtime,
        point: HOOK_POINTS.BEFORE_STATE_COMMIT,
        context: withHookRuntimeMeta(runtime, {
          phase: "state_commit",
          commitType: "assistant_message",
          status: "start",
          payload: assistantMessage,
        }),
      });
      turnMessageStore.push(assistantMessage);
      await runRuntimeHook({
        runtime,
        point: HOOK_POINTS.AFTER_STATE_COMMIT,
        context: withHookRuntimeMeta(runtime, {
          phase: "state_commit",
          commitType: "assistant_message",
          status: "success",
          payload: assistantMessage,
        }),
      });
    },
    async pushToolResult({ call = {}, toolResultText = "" } = {}) {
      const resolvedCallId = resolveCallId(call);
      const resolvedCallName = resolveCallName(call);
      const toolResultPayload = {
        role: "tool",
        content: String(toolResultText || ""),
        type: "tool_result",
        dialogProcessId,
        tool_call_id: resolvedCallId,
        toolName: resolvedCallName,
      };
      await runRuntimeHook({
        runtime,
        point: HOOK_POINTS.BEFORE_STATE_COMMIT,
        context: withHookRuntimeMeta(runtime, {
          phase: "state_commit",
          commitType: "tool_result",
          status: "start",
          payload: toolResultPayload,
          call,
        }),
      });
      const normalizedToolResultText = String(toolResultPayload.content || "");
      if (Array.isArray(traces)) {
        traces.push({
          tool: resolvedCallName,
          args: call?.args || {},
          result: normalizedToolResultText.slice(0, TOOL_RESULT_TRACE_TRUNCATE_LENGTH),
        });
      }
      if (Array.isArray(messages)) {
        messages.push(
          new ToolMessage({
            tool_call_id: resolvedCallId,
            content: normalizedToolResultText,
          }),
        );
      }
      if (turnMessageStore?.push) {
        turnMessageStore.push(toolResultPayload);
      }
      await runRuntimeHook({
        runtime,
        point: HOOK_POINTS.AFTER_STATE_COMMIT,
        context: withHookRuntimeMeta(runtime, {
          phase: "state_commit",
          commitType: "tool_result",
          status: "success",
          payload: toolResultPayload,
          call,
        }),
      });
    },
    async appendAttachmentMetas(attachmentMetas = []) {
      if (!Array.isArray(attachmentMetas) || !attachmentMetas.length) return;
      await runRuntimeHook({
        runtime,
        point: HOOK_POINTS.BEFORE_STATE_COMMIT,
        context: withHookRuntimeMeta(runtime, {
          phase: "state_commit",
          commitType: "attachment_metas",
          status: "start",
          payload: { attachmentMetas },
        }),
      });
      appendAttachmentMetasToRuntimeAndTurn({
        runtime,
        turnMessageStore,
        attachmentMetas,
      });
      await runRuntimeHook({
        runtime,
        point: HOOK_POINTS.AFTER_STATE_COMMIT,
        context: withHookRuntimeMeta(runtime, {
          phase: "state_commit",
          commitType: "attachment_metas",
          status: "success",
          payload: { attachmentMetas },
        }),
      });
    },
  };
}
