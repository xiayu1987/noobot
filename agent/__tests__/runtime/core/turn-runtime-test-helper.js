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
import { createCanonicalMessageEventSessionManager } from "../../helpers/canonical-message-event-session-manager.js";
import { text, isFunction, isObjectLike } from "@noobot/shared/value";

export function createTestTurnMessagesStore(messages = []) {
  return createCurrentTurnMessagesStore(messages);
}

export function createTestTurnTasksStore(tasks = []) {
  return createCurrentTurnTasksStore(tasks);
}

export function createTestModelPort(providerModel = {}) {
  if (!isObjectLike(providerModel)) {
    throw new TypeError("test ModelPort requires a provider model");
  }
  return {
    async invoke(request = {}) {
      const tools = Array.isArray(request.tools) ? request.tools : [];
      const invoker =
        tools.length && typeof providerModel.bindTools === "function"
          ? providerModel.bindTools(tools, request?.options?.toolBinding || {})
          : providerModel;
      if (!isFunction(invoker?.invoke)) {
        throw new TypeError("test ModelPort provider must expose invoke()");
      }
      const response = await invoker.invoke(request.messages || [], {
        ...(request?.options?.invoke || {}),
        callbacks: request?.options?.callbacks,
        signal: request?.options?.signal,
      });
      return {
        output: {
          ...(typeof response?.content === "string" || Array.isArray(response?.content)
            ? { content: response.content }
            : {}),
          text:
            response?.text !== undefined
              ? String(response.text)
              : typeof response?.content === "string"
                ? response.content
                : "",
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

function bindTestTurnIdentity(runtime, identity) {
  const { systemRuntime } = runtime;
  if (!isObjectLike(systemRuntime)) {
    throw new Error("test Turn execution requires runtime.systemRuntime");
  }
  const runIdentity = {
    turnScopeId: String(systemRuntime.turnScopeId || `turn-${identity}`),
    messageId: `message-${identity}`,
    executionId: String(runtime.runConfig?.executionId || `run-${identity}`),
  };
  runtime.runConfig = { ...runtime.runConfig, ...runIdentity };
  systemRuntime.sessionId = String(systemRuntime.sessionId || `session-${identity}`);
  systemRuntime.dialogProcessId = String(systemRuntime.dialogProcessId || `dialog-${identity}`);
  systemRuntime.turnScopeId = runIdentity.turnScopeId;
  bindAssistantMessageEventStream(runtime, {
    messageId: runIdentity.messageId,
    presentationMessageId: `presentation-${identity}`,
  });
  return runIdentity;
}

export function prepareTestTurnExecution(modelState = {}, loopState = {}, identity = "test-turn") {
  const runtime = modelState?.runtime;
  if (!isObjectLike(runtime)) {
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
  runtime.sessionManager =
    runtime.sessionManager || createCanonicalMessageEventSessionManager({ producerId: identity });
  const runIdentity = bindTestTurnIdentity(runtime, String(identity || "test-turn"));
  if (!text(loopState.modelContext?.activeTurnIdentity?.turnScopeId)) {
    loopState.modelContext.activeTurnIdentity = {
      dialogProcessId: String(loopState.dialogProcessId || runtime.systemRuntime.dialogProcessId),
      turnScopeId: runIdentity.turnScopeId,
    };
  }
  modelState.agentContext = createTestAgentExecutionScope(runtime, {
    identity: {
      userId: runtime.systemRuntime.userId,
      sessionId: runtime.systemRuntime.sessionId,
      rootSessionId: runtime.systemRuntime.rootSessionId,
      parentSessionId: runtime.systemRuntime.parentSessionId,
      dialogProcessId: runtime.systemRuntime.dialogProcessId,
      turnScopeId: runIdentity.turnScopeId,
      runId: runIdentity.executionId,
      messageId: runIdentity.messageId,
    },
    messageBlocks: loopState.modelContext.messageBlocks,
    tools: loopState.tools,
  });
  runtime.persistCurrentTurnMessages = async () => {};
  initializeCurrentTurnMessageEventProjection(runtime);
  return { modelState, loopState };
}
