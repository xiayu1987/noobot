/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import {
  createCurrentTurnMessagesStore,
  createCurrentTurnTasksStore,
} from "../../../src/runtime/turn/current-turn-ledger.js";
import { bindAssistantMessageEventStream } from "../../../src/events/message-event-stream.js";
import { initializeCurrentTurnMessageEventProjection } from "../../../src/events/current-turn-message-event-projection.js";
import { createModelContext } from "@noobot/context-protocol";
import { createTestAgentExecutionScope } from "../../helpers/agent-execution-scope.js";

export function createTestTurnMessagesStore(messages = []) {
  return createCurrentTurnMessagesStore(messages);
}

export function createTestTurnTasksStore(tasks = []) {
  return createCurrentTurnTasksStore(tasks);
}

export function createTestModelPort(providerModel = {}) {
  if (!providerModel || typeof providerModel !== "object") {
    throw new TypeError("test ModelPort requires a provider model");
  }
  return {
    async invoke(request = {}) {
      const tools = Array.isArray(request.tools) ? request.tools : [];
      const invoker =
        tools.length && typeof providerModel.bindTools === "function"
          ? providerModel.bindTools(tools, request?.options?.toolBinding || {})
          : providerModel;
      if (typeof invoker?.invoke !== "function") {
        throw new TypeError("test ModelPort provider must expose invoke()");
      }
      const response = await invoker.invoke(request.messages || [], {
        ...(request?.options?.invoke || {}),
        callbacks: request?.options?.callbacks,
        signal: request?.options?.signal,
      });
      return {
        output: {
          text: String(response?.text ?? response?.content ?? ""),
          toolCalls: Array.isArray(response?.toolCalls)
            ? response.toolCalls
            : Array.isArray(response?.tool_calls)
              ? response.tool_calls
              : [],
          reasoning: String(response?.reasoning || ""),
          finishReason: String(
            response?.finishReason || response?.response_metadata?.finish_reason || "",
          ),
          usage: response?.usage && typeof response.usage === "object" ? response.usage : {},
        },
      };
    },
  };
}

export function bindTestTurnMessageEventDomain(runtime = {}, identity = "test-turn") {
  const suffix = String(identity || "test-turn");
  const systemRuntime =
    runtime.systemRuntime && typeof runtime.systemRuntime === "object"
      ? runtime.systemRuntime
      : (runtime.systemRuntime = {});
  systemRuntime.sessionId = String(systemRuntime.sessionId || `session-${suffix}`);
  systemRuntime.dialogProcessId = String(systemRuntime.dialogProcessId || `dialog-${suffix}`);
  systemRuntime.turnScopeId = String(systemRuntime.turnScopeId || `turn-${suffix}`);
  systemRuntime.config =
    systemRuntime.config && typeof systemRuntime.config === "object" ? systemRuntime.config : {};
  systemRuntime.config.turnScopeId = systemRuntime.turnScopeId;
  bindAssistantMessageEventStream(runtime, {
    messageId: `message-${suffix}`,
    presentationMessageId: `presentation-${suffix}`,
  });
  return runtime;
}

export function prepareTestTurnExecution(modelState = {}, loopState = {}, identity = "test-turn") {
  const runtime = modelState?.runtime;
  if (!runtime || typeof runtime !== "object") {
    throw new Error("test Turn execution requires modelState.runtime");
  }
  if (loopState.modelContext?.protocolVersion !== 3) {
    loopState.modelContext = createModelContext({
      messageStore: loopState.messageStore || null,
      messages: Array.isArray(loopState.messages) ? loopState.messages : null,
      messageBlocks: loopState.messageBlocks || null,
    });
  }
  delete loopState.messageStore;
  delete loopState.messages;
  delete loopState.messageBlocks;
  loopState.currentTurnMessages = createTestTurnMessagesStore(
    typeof loopState?.currentTurnMessages?.toArray === "function"
      ? loopState.currentTurnMessages.toArray()
      : loopState.turnMessages,
  );
  loopState.currentTurnTasks = createTestTurnTasksStore(
    typeof loopState?.currentTurnTasks?.toArray === "function"
      ? loopState.currentTurnTasks.toArray()
      : [],
  );
  runtime.currentTurnMessages = loopState.currentTurnMessages;
  runtime.currentTurnTasks = loopState.currentTurnTasks;
  runtime.runConfig = {
    ...(runtime.runConfig && typeof runtime.runConfig === "object" ? runtime.runConfig : {}),
    executionId: String(runtime?.runConfig?.executionId || `run-${identity}`),
  };
  bindTestTurnMessageEventDomain(runtime, identity);
  if (!String(loopState.modelContext?.activeTurnIdentity?.turnScopeId || "").trim()) {
    loopState.modelContext.activeTurnIdentity = {
      dialogProcessId: String(loopState.dialogProcessId || runtime.systemRuntime.dialogProcessId),
      turnScopeId: String(runtime.systemRuntime.turnScopeId),
    };
  }
  modelState.agentContext = createTestAgentExecutionScope(runtime, {
    identity: {
      userId: runtime.userId,
      sessionId: runtime.systemRuntime.sessionId,
      rootSessionId: runtime.systemRuntime.rootSessionId,
      parentSessionId: runtime.systemRuntime.parentSessionId,
      dialogProcessId: runtime.systemRuntime.dialogProcessId,
      turnScopeId: runtime.systemRuntime.turnScopeId,
      runId: runtime.runConfig.executionId,
      messageId: runtime.systemRuntime.messageId || `message-${identity}`,
    },
    messageBlocks: loopState.modelContext.messageBlocks,
    tools: loopState.tools,
  });
  initializeCurrentTurnMessageEventProjection(runtime, { sequenceScopeId: identity });
  return { modelState, loopState };
}
