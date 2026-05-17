import test from "node:test";
import assert from "node:assert/strict";

import {
  resolveLlmForTurn,
  resolveCurrentModelInfo,
  createStreamingCallbacks,
} from "../../../../src/system-core/agent/core/model/model-manager.js";

test("resolveCurrentModelInfo should return trimmed alias/name", () => {
  const result = resolveCurrentModelInfo({
    activeModelAlias: " openai ",
    activeModelName: " gpt-4o ",
  });
  assert.deepEqual(result, {
    modelAlias: "openai",
    modelName: "gpt-4o",
  });
});

test("createStreamingCallbacks should emit llm_delta event", async () => {
  const events = [];
  const callbacks = createStreamingCallbacks({
    onEvent(payload = {}) {
      events.push(payload);
    },
  });
  assert.equal(Array.isArray(callbacks), true);
  await callbacks[0].handleLLMNewToken("hello");
  assert.equal(events.length, 1);
  assert.equal(events[0]?.event, "llm_delta");
  assert.equal(events[0]?.data?.text, "hello");
});

test("resolveLlmForTurn should switch model by runtimeModel and emit model_switched", () => {
  const previousApiKey = process.env.OPENAI_API_KEY;
  process.env.OPENAI_API_KEY = "test-key";
  try {
    const events = [];
    const modelState = {
      llm: { id: "old-llm" },
      activeModelName: "gpt-4o",
      activeModelAlias: "openai",
      eventListener: {
        onEvent(payload = {}) {
          events.push(payload);
        },
      },
      runtime: {
        runtimeModel: "anthropic",
      },
      globalConfig: {
        defaultProvider: "openai",
        providers: {
          openai: { model: "gpt-4o", format: "openai_compatible", enabled: true },
          anthropic: {
            model: "gpt-4.1-mini",
            format: "openai_compatible",
            enabled: true,
          },
        },
      },
      userConfig: {},
      defaultModelSpec: {
        alias: "openai",
        model: "gpt-4o",
      },
    };

    resolveLlmForTurn(modelState);

    assert.equal(modelState.activeModelAlias, "anthropic");
    assert.equal(modelState.activeModelName, "gpt-4.1-mini");
    assert.notEqual(modelState.llm?.id, "old-llm");
    const switched = events.find((item) => item?.event === "model_switched");
    assert.ok(switched);
    assert.equal(switched?.data?.alias, "anthropic");
    assert.equal(switched?.data?.model, "gpt-4.1-mini");
  } finally {
    if (previousApiKey === undefined) {
      delete process.env.OPENAI_API_KEY;
    } else {
      process.env.OPENAI_API_KEY = previousApiKey;
    }
  }
});
