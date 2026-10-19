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
import {
  applyTestIdentityToRuntime,
  createTestTurnIdentity,
  overrideTestTurnIdentity,
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

export function createLoopTurnIdentity(loopState) {
  const { dialogProcessId } = loopState;
  if (typeof dialogProcessId !== "string" || !dialogProcessId) {
    throw new TypeError("test loopState requires dialogProcessId");
  }
  return overrideTestTurnIdentity(createTestTurnIdentity(dialogProcessId), { dialogProcessId });
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

export function prepareTestTurnExecution(modelState, loopState, identity, presentationMessageId) {
  if (typeof presentationMessageId !== "string" || !presentationMessageId) {
    throw new TypeError("test turn execution requires explicit presentationMessageId");
  }
  if (identity.dialogProcessId !== loopState.dialogProcessId) {
    throw new TypeError("test turn identity dialogProcessId must equal loopState.dialogProcessId");
  }
  const runtime = modelState?.runtime;
  if (!isObjectLike(runtime)) {
    throw new Error("test Turn execution requires modelState.runtime");
  }
  if (loopState.modelContext?.protocolVersion !== 3) {
    loopState.modelContext = createModelContext({ messageBlocks: loopState.messageBlocks });
  }
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
    runtime.sessionManager ||
    createCanonicalMessageEventSessionManager({ producerId: identity.runId });
  applyTestIdentityToRuntime(runtime, identity);
  bindAssistantMessageEventStream(runtime, {
    messageId: identity.messageId,
    presentationMessageId,
  });
  bindActiveTurnIdentity(loopState.modelContext, identity);
  modelState.agentContext = createTestAgentExecutionScope(runtime, {
    identity,
    messageBlocks: loopState.modelContext.messageBlocks,
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
