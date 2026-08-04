/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { ToolMessage } from "@langchain/core/messages";
import { appendAttachmentMetasToRuntimeAndTurn } from "../../artifacts/index.js";
import { emitEvent } from "../../events/index.js";
import { TOOL_RESULT_TRACE_TRUNCATE_LENGTH } from "../constants/index.js";
import { AGENT_HOOK_POINTS, runAgentRuntimeHook } from "../../extensions/hooks/index.js";
import { buildHookContext } from "../hooks/hook-context-builder.js";
import { compactToolResultTextForModel } from "../../transfer/core/compact.js";
import { parseJsonObjectSafely } from "../utils/json-utils.js";
import { appendMessage } from "../../context/runtime-state/message-store.js";
import {
  applyAuthoritativeMessageId,
  currentAssistantPresentationMessageId,
} from "../../events/message-event-stream.js";
import { createSessionMessageUid } from "../../context/session/message-uid.js";

const HIDDEN_INTERMEDIATE_GENERATION_SOURCES = new Set([
  "doc_to_data_tool",
  "media_to_data_tool",
  "tool_result_overflow",
]);

function filterDisplayableAttachments(attachments = []) {
  return (Array.isArray(attachments) ? attachments : []).filter(
    (attachmentItem = {}) => {
      const generationSource = String(attachmentItem?.generationSource || "").trim();
      return !HIDDEN_INTERMEDIATE_GENERATION_SOURCES.has(generationSource);
    },
  );
}

function isPlainObject(value) {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function resolveTurnOwnership(runtime = {}, dialogProcessId = "") {
  const systemRuntime = runtime?.systemRuntime && typeof runtime.systemRuntime === "object"
    ? runtime.systemRuntime
    : {};
  const runConfig = runtime?.runConfig && typeof runtime.runConfig === "object"
    ? runtime.runConfig
    : systemRuntime?.runConfig && typeof systemRuntime.runConfig === "object"
      ? systemRuntime.runConfig
      : {};
  const turnScopeId = String(
    systemRuntime?.turnScopeId ||
      systemRuntime?.config?.turnScopeId ||
      runConfig?.turnScopeId ||
      "",
  ).trim();
  const resolvedDialogProcessId = String(
    dialogProcessId ||
      systemRuntime?.dialogProcessId ||
      systemRuntime?.currentDialogProcessId ||
      "",
  ).trim();
  const sessionId = String(systemRuntime?.sessionId || "").trim();
  return { turnScopeId, dialogProcessId: resolvedDialogProcessId, sessionId };
}

function annotateAttachments(attachments = [], ownership = {}) {
  const turnScopeId = String(ownership?.turnScopeId || "").trim();
  const dialogProcessId = String(ownership?.dialogProcessId || "").trim();
  const sessionId = String(ownership?.sessionId || "").trim();
  return (Array.isArray(attachments) ? attachments : []).map((attachmentItem = {}) => {
    const turnScope = {
      ...(turnScopeId ? { turnScopeId } : {}),
      ...(dialogProcessId ? { dialogProcessId } : {}),
    };
    return {
      ...(attachmentItem && typeof attachmentItem === "object" ? attachmentItem : {}),
      ...(sessionId && !String(attachmentItem?.sessionId || "").trim() ? { sessionId } : {}),
      ...(Object.keys(turnScope).length ? { turnScope } : {}),
    };
  });
}

function dedupeTransferEnvelopes(envelopes = []) {
  const output = [];
  const seen = new Set();
  for (const envelope of Array.isArray(envelopes) ? envelopes : []) {
    if (!isPlainObject(envelope)) continue;
    const key = JSON.stringify(envelope);
    if (seen.has(key)) continue;
    seen.add(key);
    output.push(envelope);
  }
  return output;
}

function parseTransferPayloadFromToolResultText(toolResultText = "") {
  const parsed = parseJsonObjectSafely(String(toolResultText || ""));
  if (!isPlainObject(parsed)) return null;
  const transferEnvelopes = dedupeTransferEnvelopes(
    Array.isArray(parsed.transferEnvelopes) ? parsed.transferEnvelopes : [],
  );
  if (!transferEnvelopes.length) return null;
  return {
    transferEnvelopes,
  };
}

export function createStateCommitter({
  messages = null,
  messageHolder = null,
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

  const ownership = resolveTurnOwnership(runtime, dialogProcessId);

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
      messageId = "",
      messageUid = "",
      presentationMessageId = "",
      chatPresentation = false,
    } = {}) {
      if (!turnMessageStore?.push) return;
      if (typeof runtime?.materializePendingCurrentTurnMessageEvents !== "function") {
        throw new Error("Turn message event materializer is required");
      }
      const pendingProjection = runtime.materializePendingCurrentTurnMessageEvents();
      const canonicalModelContent = {
        eventId: `model-content:${messageId || presentationMessageId || "turn"}`,
        event: "main_model_content",
        type: "main_model_content",
        text: String(content || ""),
        output: String(content || ""),
      };
      const canonicalActivityTimeline = [
        ...(Array.isArray(pendingProjection.activityTimeline) ? pendingProjection.activityTimeline : []),
        ...(type === "tool_call" && String(content || "").trim()
          ? [{ ...canonicalModelContent, log: canonicalModelContent }]
          : []),
      ];
      const canonicalMessageUid = String(messageUid || "").trim() || createSessionMessageUid();
      const assistantMessage = {
        messageUid: canonicalMessageUid,
        role: "assistant",
        content: String(content || ""),
        type,
        dialogProcessId,
        ...(ownership.turnScopeId ? { turnScopeId: ownership.turnScopeId } : {}),
        tool_calls: Array.isArray(toolCalls) ? toolCalls : [],
        modelAlias: String(modelAlias || "").trim(),
        modelName: String(modelName || "").trim(),
        presentationMessageId: String(presentationMessageId || "").trim(),
        chatPresentation: chatPresentation === true,
        ...(canonicalActivityTimeline.length ? { activityTimeline: canonicalActivityTimeline } : {}),
        ...(pendingProjection.toolTimeline.length ? { toolTimeline: pendingProjection.toolTimeline } : {}),
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
      applyAuthoritativeMessageId(assistantMessage, messageId);
      if (!assistantMessage.additional_kwargs || typeof assistantMessage.additional_kwargs !== "object") {
        assistantMessage.additional_kwargs = {};
      }
      assistantMessage.additional_kwargs.noobotMessageId = canonicalMessageUid;
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
      // The in-memory turn store is also the source for the running-turn
      // recovery checkpoint.  Persist it before returning from the commit so
      // an immediate reconnect cannot observe a lifecycle without its
      // analysis/tool timeline.  The callback is installed by the runner and
      // is serialized there; message events remain read-only on the client.
      await runtime?.persistCurrentTurnMessages?.();
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
      const rawTransferPayload = parseTransferPayloadFromToolResultText(toolResultText);
      const compactedToolResultText = compactToolResultTextForModel(toolResultText);
      const messageUid = createSessionMessageUid();
      const toolResultPayload = {
        messageUid,
        messageId: messageUid,
        role: "tool",
        content: compactedToolResultText,
        type: "tool_result",
        dialogProcessId,
        ...(ownership.turnScopeId ? { turnScopeId: ownership.turnScopeId } : {}),
        tool_call_id: resolvedCallId,
        toolName: resolvedCallName,
        ...(currentAssistantPresentationMessageId(runtime)
          ? { presentationMessageId: currentAssistantPresentationMessageId(runtime) }
          : {}),
      };
      const transferPayload = rawTransferPayload || parseTransferPayloadFromToolResultText(compactedToolResultText);
      if (transferPayload) {
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
      const toolMessage = new ToolMessage({
        tool_call_id: resolvedCallId,
        content: normalizedToolResultText,
        additional_kwargs: { noobotMessageId: messageUid },
      });
      if (messageHolder && typeof messageHolder === "object") {
        appendMessage(messageHolder, toolMessage, { block: "incremental" });
      } else if (Array.isArray(messages)) {
        messages.push(toolMessage);
      }
      if (turnMessageStore?.push) {
        turnMessageStore.push(toolResultPayload);
      }
      await runtime?.persistCurrentTurnMessages?.();
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
    async appendAttachmentMetas(attachments = []) {
      if (!Array.isArray(attachments) || !attachments.length) return;
      const ownedAttachments = annotateAttachments(attachments, ownership);
      await runAgentRuntimeHook({
        runtime,
        point: AGENT_HOOK_POINTS.BEFORE_STATE_COMMIT,
        context: buildHookContext(AGENT_HOOK_POINTS.BEFORE_STATE_COMMIT, runtime, {
          phase: "state_commit",
          commitType: "attachments",
          status: "start",
          payload: { attachments: ownedAttachments },
          agentContext,
        }),
      });
      const committedAttachments = annotateAttachments(ownedAttachments, ownership);
      appendAttachmentMetasToRuntimeAndTurn({
        runtime,
        turnMessageStore,
        attachments: committedAttachments,
      });
      const displayableAttachments = filterDisplayableAttachments(committedAttachments);
      if (displayableAttachments.length) {
        emitEvent(runtime?.eventListener || null, "attachments_saved", {
          dialogProcessId,
          attachments: displayableAttachments,
        });
      }
      await runAgentRuntimeHook({
        runtime,
        point: AGENT_HOOK_POINTS.AFTER_STATE_COMMIT,
        context: buildHookContext(AGENT_HOOK_POINTS.AFTER_STATE_COMMIT, runtime, {
          phase: "state_commit",
          commitType: "attachments",
          status: "success",
          payload: { attachments: committedAttachments },
          agentContext,
        }),
      });
    },
    async appendAttachments(attachments = []) {
      return this.appendAttachmentMetas(attachments);
    },
  };
}
