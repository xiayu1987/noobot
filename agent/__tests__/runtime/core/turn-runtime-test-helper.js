/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { createCurrentTurnMessagesStore } from "../../../src/context/session/current-turn-store.js";
import { bindAssistantMessageEventStream } from "../../../src/events/message-event-stream.js";
import { initializeCurrentTurnMessageEventProjection } from "../../../src/events/current-turn-message-event-projection.js";

export function createTestTurnMessagesStore(messages = []) {
  return createCurrentTurnMessagesStore(messages);
}

export function bindTestTurnMessageEventDomain(runtime = {}, identity = "test-turn") {
  const suffix = String(identity || "test-turn");
  const systemRuntime = runtime.systemRuntime && typeof runtime.systemRuntime === "object"
    ? runtime.systemRuntime
    : (runtime.systemRuntime = {});
  systemRuntime.sessionId = String(systemRuntime.sessionId || `session-${suffix}`);
  systemRuntime.dialogProcessId = String(systemRuntime.dialogProcessId || `dialog-${suffix}`);
  systemRuntime.turnScopeId = String(systemRuntime.turnScopeId || `turn-${suffix}`);
  systemRuntime.config = systemRuntime.config && typeof systemRuntime.config === "object"
    ? systemRuntime.config
    : {};
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
  loopState.currentTurnMessages = createTestTurnMessagesStore(
    typeof loopState?.currentTurnMessages?.toArray === "function"
      ? loopState.currentTurnMessages.toArray()
      : loopState.turnMessages,
  );
  runtime.currentTurnMessages = loopState.currentTurnMessages;
  bindTestTurnMessageEventDomain(runtime, identity);
  initializeCurrentTurnMessageEventProjection(runtime, { sequenceScopeId: identity });
  return { modelState, loopState };
}
