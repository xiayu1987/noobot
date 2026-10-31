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
import {
  currentAssistantPresentationMessageId,
  markAssistantDraftCommitted,
} from "../../events/message-event-stream.js";
import { createMessageUid } from "@noobot/session-protocol/message-identity";
import { resolveToolContextPolicy } from "@noobot/context-protocol/tool/context-policy";
import {
  assertCanonicalAssistantPresentation,
  canonicalAssistantPresentationIdentity,
  MESSAGE_TYPE,
  TOOL_CALL_MESSAGE_TYPE,
  TOOL_RESULT_MESSAGE_TYPE,
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
      type,
      toolCalls,
      modelAlias = "",
      modelName = "",
      modelMessageId = "",
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
        modelMessageId,
      });
      const canonicalMessageUid = text(messageUid);
      if (!canonicalMessageUid) {
        throw new TypeError("assistant message commit requires messageUid");
      }
      if (type !== MESSAGE_TYPE && type !== TOOL_CALL_MESSAGE_TYPE) {
        throw new TypeError("assistant message commit requires type message or tool_call");
      }
      if (
        (type === TOOL_CALL_MESSAGE_TYPE) !==
        (Array.isArray(toolCalls) && toolCalls.length > 0)
      ) {
        throw new TypeError(
          "assistant tool_call commit requires non-empty toolCalls, and only tool_call",
        );
      }
      const assistantMessage = {
        messageUid: canonicalMessageUid,
        modelMessageId: text(modelMessageId),
        role: "assistant",
        content: String(content || ""),
        type,
        dialogProcessId,
        ...(ownership.turnScopeId ? { turnScopeId: ownership.turnScopeId } : {}),
        ...(type === TOOL_CALL_MESSAGE_TYPE ? { tool_calls: toolCalls } : {}),
        modelAlias: text(modelAlias),
        modelName: text(modelName),
        presentationMessageId: text(presentationMessageId),
        chatPresentation: chatPresentation === true,
        ...(chatPresentation === true
          ? { workspaceRootDirectory: runtime.workspaceRootDirectory }
          : {}),
        ...(Array.isArray(transferEnvelopes) && transferEnvelopes.length
          ? { transferEnvelopes }
          : {}),
        ...(Array.isArray(attachments) && attachments.length ? { attachments } : {}),
        ...(pendingProjection.activityTimeline.length
          ? { activityTimeline: pendingProjection.activityTimeline }
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
          { chatPresentation: false, workspaceRootDirectory: undefined },
          (message) =>
            canonicalAssistantPresentationIdentity(message)?.turnScopeId ===
            incomingPresentation.turnScopeId,
        );
      }
      turnMessageStore.push(assistantMessage);
      markAssistantDraftCommitted(runtime, assistantMessage.modelMessageId);

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
    async pushToolResult({
      call = {},
      toolResultText = "",
      transferEnvelopes,
      resourceRefs,
      mutationRefs,
    } = {}) {
      const resolvedCallId = text(call.id);
      for (const [field, value] of Object.entries({
        transferEnvelopes,
        resourceRefs,
        mutationRefs,
      })) {
        if (!Array.isArray(value)) {
          throw new TypeError(`tool result commit requires a ${field} array`);
        }
      }
      const resolvedCallName = text(call.name);
      const compactedToolResultText = compactToolResultTextForModel(toolResultText);
      const messageUid = createMessageUid();
      const contextPolicy = resolveToolContextPolicy(call);
      const toolResultPayload = {
        messageUid,
        role: "tool",
        content: compactedToolResultText,
        type: TOOL_RESULT_MESSAGE_TYPE,
        dialogProcessId,
        ...(ownership.turnScopeId ? { turnScopeId: ownership.turnScopeId } : {}),
        tool_call_id: resolvedCallId,
        toolName: resolvedCallName,
        ...(contextPolicy ? { contextPolicy } : {}),
        presentationMessageId: currentAssistantPresentationMessageId(runtime),
      };
      if (transferEnvelopes.length) toolResultPayload.transferEnvelopes = transferEnvelopes;
      if (resourceRefs.length) toolResultPayload.resourceRefs = resourceRefs;
      if (mutationRefs.length) toolResultPayload.mutationRefs = mutationRefs;
      await runAgentRuntimeHook({
        runtime,
        point: HOOK_POINT.AGENT.BEFORE_STATE_COMMIT,
        context: buildHookContext(HOOK_POINT.AGENT.BEFORE_STATE_COMMIT, runtime, {
          phase: "state_commit",
          commitType: "tool_result",
          status: HOOK_PHASE_STATUS.RUNNING,
          payload: toolResultPayload,
          call,
          toolName: resolvedCallName,
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
          toolName: resolvedCallName,
          agentContext,
        }),
      });
    },
  };
}
