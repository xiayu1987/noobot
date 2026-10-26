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
import { normalizeSystemRuntimeCounters } from "@noobot/agent-config-protocol";
import { createTestAgentExecutionScope } from "../../helpers/agent-execution-scope.js";
import {
  bindTestIdentityToRuntime,
  deriveTestTurnIdentity,
} from "../../helpers/test-turn-identity.js";
import { isFunction, isObjectLike } from "@noobot/shared/value";

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

function bindActiveTurnIdentity(modelContext, identity) {
  const expected = { dialogProcessId: identity.dialogProcessId, turnScopeId: identity.turnScopeId };
  const current = modelContext.activeTurnIdentity;
  if (current != null) {
    if (
      current.dialogProcessId !== expected.dialogProcessId ||
      current.turnScopeId !== expected.turnScopeId
    ) {
      throw new TypeError("modelContext.activeTurnIdentity conflicts with test turn identity");
    }
    return;
  }
  modelContext.activeTurnIdentity = expected;
}

const LOOP_STATE_RUNTIME_FIELDS = Object.freeze([
  "turnMessages",
  "turnTasks",
  "currentTurnMessages",
  "currentTurnTasks",
  "systemRuntime",
  "toolConsecutiveFailureCount",
]);

export function prepareTestTurnExecution(modelState, loopState, presentationMessageId) {
  if (typeof presentationMessageId !== "string" || !presentationMessageId) {
    throw new TypeError("test turn execution requires explicit presentationMessageId");
  }
  const runtime = modelState?.runtime;
  if (!isObjectLike(runtime)) {
    throw new Error("test Turn execution requires modelState.runtime");
  }
  if (Object.hasOwn(loopState, "modelContext")) {
    throw new TypeError(
      "test loopState must not carry modelContext; runtime.activeMessageContext owns it",
    );
  }
  const presetModelContext = runtime.activeMessageContext !== null;
  if (presetModelContext === Object.hasOwn(loopState, "messageBlocks")) {
    throw new TypeError(
      "test turn requires exactly one of loopState.messageBlocks or runtime.activeMessageContext",
    );
  }
  if (!presetModelContext) {
    runtime.activeMessageContext = createModelContext({ messageBlocks: loopState.messageBlocks });
    delete loopState.messageBlocks;
  }
  for (const field of LOOP_STATE_RUNTIME_FIELDS) {
    if (Object.hasOwn(loopState, field)) {
      throw new TypeError(`test loopState must not carry ${field}; runtime owns it`);
    }
  }
  normalizeSystemRuntimeCounters(runtime.systemRuntime, "");
  loopState.currentTurnMessages = runtime.currentTurnMessages;
  loopState.currentTurnTasks = runtime.currentTurnTasks;
  loopState.systemRuntime = runtime.systemRuntime;
  if (runtime.sessionManager === null) {
    throw new TypeError("test turn execution requires an explicit runtime.sessionManager");
  }
  const identity = bindTestIdentityToRuntime(
    runtime,
    deriveTestTurnIdentity(runtime, {
      runId: `run-${presentationMessageId}`,
      presentationMessageId,
    }),
  );
  bindAssistantMessageEventStream(runtime, {
    presentationMessageId: identity.presentationMessageId,
    parentSessionId: identity.parentSessionId,
    workflowRunId: "",
    nodeExecutionId: "",
  });
  bindActiveTurnIdentity(runtime.activeMessageContext, identity);
  modelState.agentContext = createTestAgentExecutionScope(runtime, {
    identity,
    messageBlocks: runtime.activeMessageContext.messageBlocks,
    tools: loopState.tools,
  });
  bindTestDispatchLifecycle(runtime);
  initializeCurrentTurnMessageEventProjection(runtime);
  return { modelState, loopState };
}

export function bindTestDispatchLifecycle(runtime) {
  runtime.persistCurrentTurnMessages = async () => {};
  runtime.withCurrentTurnPersistenceBatch = async (operation) => operation();
  runtime.consumeUserInterjections = async () => [];
  runtime.sealUserInterjectionQueueIfEmpty = () => true;
  return runtime;
}
