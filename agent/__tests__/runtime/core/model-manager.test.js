/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import test from "node:test";
import assert from "node:assert/strict";

import {
  resolveLlmForTurn,
  createStreamingCallbacks,
} from "../../../src/models/runtime/model-manager.js";
import { resolveCurrentModelInfo } from "../../../src/models/runtime/current-model-info.js";
import {
  beginAssistantMessageEventStream,
  bindAssistantMessageEventStream,
  currentAssistantDraft,
} from "../../../src/events/message-event-stream.js";
import { createCanonicalMessageEventSessionManager } from "../../helpers/canonical-message-event-session-manager.js";
import { createTestRuntimeContext } from "../../helpers/test-runtime-context.js";
import { initializeCurrentTurnMessageEventProjection } from "../../../src/events/current-turn-message-event-projection.js";

function createBoundModelRuntime(producerId) {
  const runtime = createTestRuntimeContext({
    sessionManager: createCanonicalMessageEventSessionManager({ producerId }),
    runConfig: { hookManager: null, executionId: "execution-1", commandId: "command-1" },
    identity: {
      userId: "user-1",
      sessionId: "session-1",
      dialogProcessId: "dialog-1",
      turnScopeId: "turn-1",
    },
    systemRuntime: {},
  });
  bindAssistantMessageEventStream(runtime, {
    presentationMessageId: "presentation-1",
    parentSessionId: "",
    workflowNodeOwnership: null,
  });
  initializeCurrentTurnMessageEventProjection(runtime);
  return runtime;
}

test("resolveCurrentModelInfo projects the active model spec", () => {
  const result = resolveCurrentModelInfo({
    activeModelSpec: { alias: "openai", model: "gpt-4o" },
  });
  assert.deepEqual(result, {
    modelAlias: "openai",
    modelName: "gpt-4o",
  });
});

test("createStreamingCallbacks should emit llm_delta event", async () => {
  const events = [];
  const runtime = createBoundModelRuntime("model-manager");
  beginAssistantMessageEventStream(runtime, { turn: 0 });
  const callbacks = createStreamingCallbacks(
    {
      onEvent(payload = {}) {
        events.push(payload);
      },
    },
    runtime,
  );
  assert.equal(Array.isArray(callbacks), true);
  await callbacks[0].handleLLMNewToken("hello");
  assert.equal(events.length, 1);
  assert.equal(events[0]?.event, "authority_event_committed");
  assert.equal(events[0]?.data?.envelope?.payload?.eventType, "llm_delta");
  assert.equal(events[0]?.data?.envelope?.payload?.text, "hello");
});

test("stream visibility filtering happens before the transient delta is emitted", async () => {
  const events = [];
  const runtime = createBoundModelRuntime("model-filter");
  beginAssistantMessageEventStream(runtime, { turn: 0 });
  const [callback] = createStreamingCallbacks(
    {
      onEvent(payload = {}) {
        events.push(payload);
      },
    },
    runtime,
  );

  await callback.handleLLMNewToken("<thi");
  await callback.handleLLMNewToken("nk>hidden");
  await callback.handleLLMNewToken("</think>");
  await callback.handleLLMNewToken("visible");
  await callback.handleLLMEnd();

  assert.equal(events.length, 1);
  assert.equal(events[0]?.data?.envelope?.payload?.text, "visible");
  assert.equal(events[0]?.data?.envelope?.ordering?.sequence, 0);
  assert.equal(currentAssistantDraft(runtime).content, "visible");
});

test("streaming callbacks require an active model message stream", () => {
  const runtime = createBoundModelRuntime("model-draft");
  const [callback] = createStreamingCallbacks({ onEvent() {} }, runtime);
  assert.throws(() => callback.handleLLMNewToken("hello"), /active model message stream/);
});

test("resolveLlmForTurn should switch model by runtimeModel and emit model_switched", () => {
  const events = [];
  const modelState = {
    activeModelSpec: { alias: "openai", model: "gpt-4o" },
    runtime: {
      eventListener: {
        onEvent(payload = {}) {
          events.push(payload);
        },
      },
      globalConfig: {
        defaultProvider: "openai",
        providers: {
          openai: {
            model: "gpt-4o",
            reasoning_effort_parameter: "reasoning_effort",
            reasoning_effort_options: ["none", "low", "medium", "high"],
            enabled: true,
          },
          anthropic: {
            model: "gpt-4.1-mini",
            reasoning_effort_parameter: "reasoning_effort",
            reasoning_effort_options: ["none", "low", "medium", "high"],
            enabled: true,
          },
        },
      },
      userConfig: {},
      runtimeModel: "anthropic",
    },
    defaultModelSpec: { alias: "openai", model: "gpt-4o" },
  };

  resolveLlmForTurn(modelState);

  assert.equal(modelState.activeModelSpec.alias, "anthropic");
  assert.equal(modelState.activeModelSpec.model, "gpt-4.1-mini");
  const switched = events.find((item) => item?.event === "model_switched");
  assert.equal(switched.data.alias, "anthropic");
  assert.equal(switched.data.model, "gpt-4.1-mini");
});

test("resolveLlmForTurn should select the canonical defaultModelSpec without runtimeModel", () => {
  const events = [];
  const modelState = {
    activeModelSpec: { alias: "scenario_default", model: "scenario-default-model" },
    runtime: {
      eventListener: {
        onEvent(payload = {}) {
          events.push(payload);
        },
      },
      globalConfig: {
        defaultProvider: "scenario_default",
        providers: {
          scenario_default: {
            model: "scenario-default-model",
            reasoning_effort_parameter: "reasoning_effort",
            reasoning_effort_options: ["none", "low", "medium", "high"],
            enabled: true,
          },
          selected_alias: {
            model: "selected-model",
            reasoning_effort_parameter: "reasoning_effort",
            reasoning_effort_options: ["none", "low", "medium", "high"],
            enabled: true,
          },
        },
      },
      userConfig: {},
    },
    defaultModelSpec: { alias: "selected_alias", model: "selected-model" },
  };

  resolveLlmForTurn(modelState);

  assert.equal(modelState.activeModelSpec, modelState.defaultModelSpec);
  const switched = events.find((item) => item?.event === "model_switched");
  assert.equal(switched.data.alias, "selected_alias");
  assert.equal(switched.data.model, "selected-model");
});
