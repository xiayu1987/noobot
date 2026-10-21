/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { TOOL_RESULT_TRACE_TRUNCATE_LENGTH } from "../constants/index.js";
import {
  getSystemRuntimeFromRuntime,
  resolveRuntimeTurnScopeId,
} from "../../context/agent-context-accessor.js";
import { runAgentRuntimeHook } from "../../extensions/hooks/index.js";
import { HOOK_PHASE_STATUS, HOOK_POINT } from "@noobot/hook-protocol";
import { buildHookContext } from "../hooks/hook-context-builder.js";
import { compactToolResultTextForModel } from "../../transfer-adapter/core/compact.js";
import { appendToolResultModelMessage } from "../message-context/message-store.js";
import { currentAssistantPresentationMessageId } from "../../events/message-event-stream.js";
import { createMessageUid } from "@noobot/session-protocol/message-identity";
import { resolveToolContextPolicy } from "@noobot/context-protocol/tool/context-policy";
import {
  assertCanonicalAssistantPresentation,
  canonicalAssistantPresentationIdentity,
} from "@noobot/session-protocol";
import { isPlainObject, text, isFunction } from "@noobot/shared/value";

function resolveTurnOwnership(runtime = {}, dialogProcessId = "") {
  const systemRuntime = getSystemRuntimeFromRuntime(runtime);
  const turnScopeId = resolveRuntimeTurnScopeId(runtime);
  const resolvedDialogProcessId = text(dialogProcessId || systemRuntime?.dialogProcessId);
  const sessionId = text(systemRuntime?.sessionId);
  return { turnScopeId, dialogProcessId: resolvedDialogProcessId, sessionId };
}

export function createStateCommitter({
  modelContext = null,
  traces = null,
  turnMessageStore = null,
  dialogProcessId = "",
  runtime = {},
  agentContext = null,
} = {}) {
  if (!isFunction(turnMessageStore?.push)) {
    throw new TypeError("state committer requires the current Turn message store");
  }
  if (!isFunction(runtime?.persistCurrentTurnMessages)) {
    throw new TypeError("state committer requires runtime.persistCurrentTurnMessages");
  }
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
      transferEnvelopes = [],
      attachments = [],
    } = {}) {
      if (!isFunction(runtime?.materializePendingCurrentTurnMessageEvents)) {
        throw new Error("Turn message event materializer is required");
      }
      const pendingProjection = runtime.materializePendingCurrentTurnMessageEvents({
        modelMessageId: messageId,
      });
      const canonicalActivityTimeline = Array.isArray(pendingProjection.activityTimeline)
        ? pendingProjection.activityTimeline
        : [];
      const canonicalMessageUid = text(messageUid);
      if (!canonicalMessageUid) {
        throw new TypeError("assistant message commit requires messageUid");
      }
      const assistantMessage = {
        messageUid: canonicalMessageUid,
        messageId: text(messageId),
        role: "assistant",
        content: String(content || ""),
        type,
        dialogProcessId,
        ...(ownership.turnScopeId ? { turnScopeId: ownership.turnScopeId } : {}),
        tool_calls: Array.isArray(toolCalls) ? toolCalls : [],
        modelAlias: text(modelAlias),
        modelName: text(modelName),
        presentationMessageId: text(presentationMessageId),
        chatPresentation: chatPresentation === true,
        ...(Array.isArray(transferEnvelopes) && transferEnvelopes.length
          ? { transferEnvelopes }
          : {}),
        ...(Array.isArray(attachments) && attachments.length ? { attachments } : {}),
        ...(canonicalActivityTimeline.length
          ? { activityTimeline: canonicalActivityTimeline }
          : {}),
        ...(pendingProjection.toolTimeline.length
          ? { toolTimeline: pendingProjection.toolTimeline }
          : {}),
        rawModelContent:
          typeof rawModelContent === "string" || Array.isArray(rawModelContent)
            ? rawModelContent
            : null,
        modelAdditionalKwargs: isPlainObject(modelAdditionalKwargs) ? modelAdditionalKwargs : null,
        modelResponseMetadata: isPlainObject(modelResponseMetadata) ? modelResponseMetadata : null,
      };
      await runAgentRuntimeHook({
        runtime,
        point: HOOK_POINT.AGENT.BEFORE_STATE_COMMIT,
        context: buildHookContext(HOOK_POINT.AGENT.BEFORE_STATE_COMMIT, runtime, {
          phase: "state_commit",
          commitType: "assistant_message",
          status: HOOK_PHASE_STATUS.RUNNING,
          payload: assistantMessage,
          agentContext,
        }),
      });
      if (assistantMessage.chatPresentation === true) {
        assertCanonicalAssistantPresentation(assistantMessage);
        if (!isFunction(turnMessageStore.updateWhere)) {
          throw new Error("canonical assistant presentation requires an updatable Turn store");
        }
        const incomingPresentation = canonicalAssistantPresentationIdentity(assistantMessage);
        turnMessageStore.updateWhere(
          { chatPresentation: false },
          (message) =>
            canonicalAssistantPresentationIdentity(message)?.turnScopeId ===
            incomingPresentation.turnScopeId,
        );
      }
      turnMessageStore.push(assistantMessage);

      await runtime.persistCurrentTurnMessages();
      await runAgentRuntimeHook({
        runtime,
        point: HOOK_POINT.AGENT.AFTER_STATE_COMMIT,
        context: buildHookContext(HOOK_POINT.AGENT.AFTER_STATE_COMMIT, runtime, {
          phase: "state_commit",
          commitType: "assistant_message",
          status: HOOK_PHASE_STATUS.SUCCESS,
          payload: assistantMessage,
          agentContext,
        }),
      });
    },
    async pushToolResult({ call = {}, toolResultText = "", transferEnvelopes = [] } = {}) {
      const resolvedCallId = text(call.id);
      const resolvedCallName = text(call.name);
      const compactedToolResultText = compactToolResultTextForModel(toolResultText);
      const messageUid = createMessageUid();
      const contextPolicy = resolveToolContextPolicy(call);
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
        ...(contextPolicy ? { contextPolicy } : {}),
        ...(currentAssistantPresentationMessageId(runtime)
          ? { presentationMessageId: currentAssistantPresentationMessageId(runtime) }
          : {}),
      };
      if (Array.isArray(transferEnvelopes) && transferEnvelopes.length) {
        toolResultPayload.transferEnvelopes = transferEnvelopes;
      }
      await runAgentRuntimeHook({
        runtime,
        point: HOOK_POINT.AGENT.BEFORE_STATE_COMMIT,
        context: buildHookContext(HOOK_POINT.AGENT.BEFORE_STATE_COMMIT, runtime, {
          phase: "state_commit",
          commitType: "tool_result",
          status: HOOK_PHASE_STATUS.RUNNING,
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
      appendToolResultModelMessage({
        modelContext,
        toolCallId: resolvedCallId,
        content: normalizedToolResultText,
        messageUid,
        contextPolicy,
      });
      turnMessageStore.push(toolResultPayload);
      await runtime.persistCurrentTurnMessages();
      await runAgentRuntimeHook({
        runtime,
        point: HOOK_POINT.AGENT.AFTER_STATE_COMMIT,
        context: buildHookContext(HOOK_POINT.AGENT.AFTER_STATE_COMMIT, runtime, {
          phase: "state_commit",
          commitType: "tool_result",
          status: HOOK_PHASE_STATUS.SUCCESS,
          payload: toolResultPayload,
          call,
          agentContext,
        }),
      });
    },
  };
}
