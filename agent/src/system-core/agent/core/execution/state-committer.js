/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { ToolMessage } from "@langchain/core/messages";
import { appendAttachmentMetasToRuntimeAndTurn } from "../../../attach/index.js";
import { emitEvent } from "../../../event/index.js";
import { TOOL_RESULT_TRACE_TRUNCATE_LENGTH } from "../constants/index.js";
import { AGENT_HOOK_POINTS, runAgentRuntimeHook } from "../../../hook/index.js";
import { buildHookContext } from "../hook/hook-context-builder.js";
import { compactToolResultTextForModel } from "../../../semantic-transfer/core/compact.js";
import { parseJsonObjectSafely } from "../utils/json-utils.js";

const HIDDEN_INTERMEDIATE_GENERATION_SOURCES = new Set([
  "doc_to_data_tool",
  "media_to_data_tool",
  "tool_result_overflow",
]);

function filterDisplayableAttachmentMetas(attachmentMetas = []) {
  return (Array.isArray(attachmentMetas) ? attachmentMetas : []).filter(
    (attachmentItem = {}) => {
      const generationSource = String(attachmentItem?.generationSource || "").trim();
      return !HIDDEN_INTERMEDIATE_GENERATION_SOURCES.has(generationSource);
    },
  );
}

function isPlainObject(value) {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function parseTransferPayloadFromToolResultText(toolResultText = "") {
  const parsed = parseJsonObjectSafely(String(toolResultText || ""));
  if (!isPlainObject(parsed)) return null;
  const transferResult = isPlainObject(parsed.transferResult) ? parsed.transferResult : null;
  const transferEnvelope = isPlainObject(parsed.transferEnvelope)
    ? parsed.transferEnvelope
    : isPlainObject(transferResult?.envelope)
      ? transferResult.envelope
      : null;
  const transferEnvelopes = Array.isArray(parsed.transferEnvelopes)
    ? parsed.transferEnvelopes.filter(isPlainObject)
    : transferEnvelope
      ? [transferEnvelope]
      : [];
  if (!transferResult && !transferEnvelope && !transferEnvelopes.length) return null;
  return {
    ...(transferResult ? { transferResult } : {}),
    ...(transferEnvelope ? { transferEnvelope } : {}),
    ...(transferEnvelopes.length ? { transferEnvelopes } : {}),
  };
}

export function createStateCommitter({
  messages = null,
  traces = null,
  turnMessageStore = null,
  dialogProcessId = "",
  runtime = {},
  agentContext = null,
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
      await runAgentRuntimeHook({
        runtime,
        point: AGENT_HOOK_POINTS.BEFORE_STATE_COMMIT,
        context: buildHookContext(AGENT_HOOK_POINTS.BEFORE_STATE_COMMIT, runtime, {
          phase: "state_commit",
          commitType: "assistant_message",
          status: "start",
          payload: assistantMessage,
          agentContext,
        }),
      });
      turnMessageStore.push(assistantMessage);
      await runAgentRuntimeHook({
        runtime,
        point: AGENT_HOOK_POINTS.AFTER_STATE_COMMIT,
        context: buildHookContext(AGENT_HOOK_POINTS.AFTER_STATE_COMMIT, runtime, {
          phase: "state_commit",
          commitType: "assistant_message",
          status: "success",
          payload: assistantMessage,
          agentContext,
        }),
      });
    },
    async pushToolResult({ call = {}, toolResultText = "" } = {}) {
      const resolvedCallId = resolveCallId(call);
      const resolvedCallName = resolveCallName(call);
      const compactedToolResultText = compactToolResultTextForModel(toolResultText);
      const toolResultPayload = {
        role: "tool",
        content: compactedToolResultText,
        type: "tool_result",
        dialogProcessId,
        tool_call_id: resolvedCallId,
        toolName: resolvedCallName,
      };
      const transferPayload = parseTransferPayloadFromToolResultText(compactedToolResultText);
      if (transferPayload) {
        if (transferPayload.transferResult) {
          toolResultPayload.transferResult = transferPayload.transferResult;
        }
        if (Array.isArray(transferPayload.transferEnvelopes) && transferPayload.transferEnvelopes.length) {
          toolResultPayload.transferEnvelopes = transferPayload.transferEnvelopes;
        }
      }
      await runAgentRuntimeHook({
        runtime,
        point: AGENT_HOOK_POINTS.BEFORE_STATE_COMMIT,
        context: buildHookContext(AGENT_HOOK_POINTS.BEFORE_STATE_COMMIT, runtime, {
          phase: "state_commit",
          commitType: "tool_result",
          status: "start",
          payload: toolResultPayload,
          call,
          agentContext,
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
      await runAgentRuntimeHook({
        runtime,
        point: AGENT_HOOK_POINTS.AFTER_STATE_COMMIT,
        context: buildHookContext(AGENT_HOOK_POINTS.AFTER_STATE_COMMIT, runtime, {
          phase: "state_commit",
          commitType: "tool_result",
          status: "success",
          payload: toolResultPayload,
          call,
          agentContext,
        }),
      });
    },
    async appendAttachmentMetas(attachmentMetas = []) {
      if (!Array.isArray(attachmentMetas) || !attachmentMetas.length) return;
      await runAgentRuntimeHook({
        runtime,
        point: AGENT_HOOK_POINTS.BEFORE_STATE_COMMIT,
        context: buildHookContext(AGENT_HOOK_POINTS.BEFORE_STATE_COMMIT, runtime, {
          phase: "state_commit",
          commitType: "attachment_metas",
          status: "start",
          payload: { attachmentMetas },
          agentContext,
        }),
      });
      appendAttachmentMetasToRuntimeAndTurn({
        runtime,
        turnMessageStore,
        attachmentMetas,
      });
      const displayableAttachmentMetas = filterDisplayableAttachmentMetas(attachmentMetas);
      if (displayableAttachmentMetas.length) {
        emitEvent(runtime?.eventListener || null, "attachment_metas_saved", {
          dialogProcessId,
          attachmentMetas: displayableAttachmentMetas,
        });
      }
      await runAgentRuntimeHook({
        runtime,
        point: AGENT_HOOK_POINTS.AFTER_STATE_COMMIT,
        context: buildHookContext(AGENT_HOOK_POINTS.AFTER_STATE_COMMIT, runtime, {
          phase: "state_commit",
          commitType: "attachment_metas",
          status: "success",
          payload: { attachmentMetas },
          agentContext,
        }),
      });
    },
  };
}
