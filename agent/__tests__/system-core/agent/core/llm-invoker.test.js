import test from "node:test";
import assert from "node:assert/strict";

import { invokeLlmWithTransientRetry } from "../../../../src/system-core/agent/core/llm-invoker.js";

function createEventCollector() {
  const events = [];
  return {
    events,
    listener: {
      onEvent(payload = {}) {
        events.push(payload);
      },
    },
  };
}

test("invokeLlmWithTransientRetry: transient error should retry and then succeed", async () => {
  let attempts = 0;
  const { events, listener } = createEventCollector();
  const modelState = {
    activeModelAlias: "openai",
    activeModelName: "gpt-4o",
    eventListener: listener,
    abortSignal: null,
  };

  const result = await invokeLlmWithTransientRetry({
    modelState,
    turn: 1,
    mode: "test",
    invoke: async () => {
      attempts += 1;
      if (attempts === 1) {
        const error = new Error("internal server error");
        error.status = 503;
        throw error;
      }
      return "ok";
    },
  });

  assert.equal(result, "ok");
  assert.equal(attempts, 2);
  const retryEvent = events.find((item) => item?.event === "llm_call_retry");
  assert.ok(retryEvent, "应记录 llm_call_retry");
  assert.equal(retryEvent?.data?.attempt, 1);
  assert.equal(retryEvent?.data?.nextAttempt, 2);
});

test("invokeLlmWithTransientRetry: if token already streamed, should not retry", async () => {
  let attempts = 0;
  const { events, listener } = createEventCollector();
  const modelState = {
    activeModelAlias: "openai",
    activeModelName: "gpt-4o",
    eventListener: listener,
    abortSignal: null,
  };

  await assert.rejects(
    () =>
      invokeLlmWithTransientRetry({
        modelState,
        turn: 2,
        mode: "test",
        invoke: async ({ callbacks = [] } = {}) => {
          attempts += 1;
          if (typeof callbacks?.[0]?.handleLLMNewToken === "function") {
            await callbacks[0].handleLLMNewToken("x");
          }
          const error = new Error("rate limit");
          error.status = 429;
          throw error;
        },
      }),
    /rate limit/i,
  );

  assert.equal(attempts, 1);
  const errorEvent = events.find((item) => item?.event === "llm_call_error");
  assert.ok(errorEvent, "应记录 llm_call_error");
  assert.equal(errorEvent?.data?.streamedTokens, 1);
});

test("invokeLlmWithTransientRetry: abort-like error should not retry", async () => {
  let attempts = 0;
  const { events, listener } = createEventCollector();
  const modelState = {
    activeModelAlias: "openai",
    activeModelName: "gpt-4o",
    eventListener: listener,
    abortSignal: {
      reason: { type: "user_stop", code: 499 },
    },
  };

  await assert.rejects(
    () =>
      invokeLlmWithTransientRetry({
        modelState,
        turn: 3,
        mode: "test",
        invoke: async () => {
          attempts += 1;
          const error = new Error("aborted by user");
          error.name = "AbortError";
          throw error;
        },
      }),
    /aborted/i,
  );

  assert.equal(attempts, 1);
  const abortEvent = events.find((item) => item?.event === "llm_call_aborted");
  assert.ok(abortEvent, "应记录 llm_call_aborted");
  assert.equal(abortEvent?.data?.abortSource, "user_stop");
  assert.equal(abortEvent?.data?.abortCode, 499);
});
