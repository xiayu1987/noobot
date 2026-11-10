/* Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import test from "node:test";
import assert from "node:assert/strict";
import { createModelRequestExecutor } from "../src/index.js";
import { ModelProtocolError, SYSTEM_CLOCK_PORT } from "@noobot/model-protocol";
import {
  invocation,
  model,
  partialOutputResponse,
  consumePartialOutput,
} from "./runtime-fixtures.js";

function createHarness(invoke, options = {}) {
  const modes = [];
  const events = [];
  const executor = createModelRequestExecutor({
    registry: {
      resolve: () => ({
        id: "openai-compatible",
        classifyError: () => ({ kind: "unknown" }),
        bindTools: ({ client }) => client,
        prepareMessages: ({ messages }) => messages,
        resolveResponseSource: () => "message",
        createClient: ({ streaming, fetch }) => {
          modes.push(streaming);
          return { invoke: (messages, options) => invoke(messages, options, fetch) };
        },
      }),
    },
    credentialPort: { resolve: () => "test-key" },
    observationPort: { emit: (type, payload) => events.push({ type, ...payload }) },
    clock: { now: () => 0, sleep: async () => {} },
    providerRuntime: { fetchImpl: async () => partialOutputResponse() },
    ...options,
  });
  return {
    modes,
    events,
    invoke: (input = {}) => executor.invoke({ invocation, model, messages: [], ...input }),
  };
}

test("failed semantic validation cannot publish a preferred streaming mode", async () => {
  let calls = 0;
  const ctx = createHarness(async () => ({ content: ++calls === 1 ? "" : "ok" }));
  await assert.rejects(
    ctx.invoke({
      options: { streaming: true },
      policies: { retry: { maxTotalAttempts: 1 } },
    }),
    { kind: "empty_response" },
  );
  assert.equal((await ctx.invoke({ options: { streaming: false } })).output.text, "ok");
  assert.deepEqual(ctx.modes, [true, false]);
});

for (const key of ["callbacks", "signal", "stream", "streaming"]) {
  test(`invoke options cannot override executor-owned ${key}`, async () => {
    let calls = 0;
    const ctx = createHarness(async () => {
      calls += 1;
    });
    await assert.rejects(
      ctx.invoke({ options: { invoke: { [key]: undefined } } }),
      /is owned by the executor/,
    );
    assert.equal(calls, 0);
    assert.deepEqual(ctx.modes, []);
  });
}

for (const callbacks of [undefined, []]) {
  test(`partial output prevents replay with callbacks=${JSON.stringify(callbacks)}`, async () => {
    let calls = 0;
    const ctx = createHarness(async (_messages, _options, fetch) => {
      calls += 1;
      await consumePartialOutput(fetch);
      throw new Error("upstream failure");
    });
    await assert.rejects(
      ctx.invoke({ options: { streaming: true, callbacks } }),
      /upstream failure/,
    );
    assert.equal(calls, 1);
  });
}

for (const kind of ["temporary_unavailable", "unknown", "empty_response"]) {
  test(`cancellation interrupts ${kind} recovery wait and emits one terminal`, async () => {
    const controller = new AbortController();
    const entered = Promise.withResolvers();
    let calls = 0;
    const ctx = createHarness(
      async () => {
        calls += 1;
        if (kind === "empty_response") return { content: "" };
        throw new ModelProtocolError("upstream failure", { kind });
      },
      {
        clock: {
          now: SYSTEM_CLOCK_PORT.now,
          sleep: (ms, options) => {
            entered.resolve();
            return SYSTEM_CLOCK_PORT.sleep(ms, options);
          },
        },
      },
    );
    const pending = ctx.invoke({ options: { signal: controller.signal } });
    const rejected = assert.rejects(pending, { name: "AbortError" });
    await entered.promise;
    controller.abort();
    await rejected;
    assert.equal(calls, 1);
    assert.deepEqual(
      ctx.events
        .filter(({ type }) => /\.(cancelled|failed|completed)$/.test(type))
        .map(({ type }) => type),
      ["model.invocation.cancelled"],
    );
  });
}
