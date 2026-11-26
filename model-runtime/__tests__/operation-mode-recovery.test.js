/* Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import test from "node:test";
import assert from "node:assert/strict";
import { classifyProviderFailure, MODEL_RESPONSE_SOURCE } from "@noobot/model-protocol";
import { createModelRequestExecutor } from "../src/index.js";
import { invocation, model } from "./runtime-fixtures.js";

function setup(operationKind, streaming, failures, maxTotalAttempts = 6) {
  const calls = [];
  const events = [];
  const adapter = {
    id: "openai-compatible",
    createClient: () => ({}),
    bindTools: ({ client }) => client,
    prepareMessages: ({ messages }) => messages,
    invokeChat: async () => ({ content: "unused" }),
    resolveResponseSource: () => MODEL_RESPONSE_SOURCE.MESSAGE,
    resolveOperationStreamingModes: () => [false, true],
    classifyError: (error) =>
      error.facts ? classifyProviderFailure(error.facts) : { kind: "unknown" },
    async executeOperation({ streaming: actual }) {
      calls.push(actual);
      const failure = failures.shift();
      if (failure) throw failure;
      return operationKind === "web_search"
        ? { rawText: "done", sources: [] }
        : { rawText: "done", output: [] };
    },
  };
  const executor = createModelRequestExecutor({
    registry: { resolve: () => adapter },
    credentialPort: { resolve: () => "test-key" },
    clock: { now: () => 0, sleep: async () => {} },
    observationPort: { emit: (type) => events.push(type) },
  });
  const request = {
    invocation,
    model,
    messages: [],
    options: { streaming },
    operation:
      operationKind === "web_search"
        ? { kind: operationKind, input: { query: "query" } }
        : {
            kind: operationKind,
            input: {
              prompt: "parse",
              attachments: [
                { mimeType: "image/png", data: "data:image/png;base64,AQ==", fileName: "a.png" },
              ],
            },
          },
    policies: { retry: { maxTotalAttempts, transport: { maxAttempts: 2, baseDelayMs: 0 } } },
  };
  return { calls, events, run: () => executor.invoke(request) };
}

function upstream(facts) {
  return Object.assign(new Error("upstream rejected"), { facts });
}

for (const operationKind of ["web_search", "multimodal_parse"]) {
  for (const streaming of [false, true]) {
    const prefix = `${operationKind} requested=${streaming}`;
    for (const [name, facts] of [
      [
        "documented mode error",
        { operatorId: "openai", code: "unsupported_value", param: "stream", status: 400 },
      ],
      ["unknown upstream error", { operatorId: "openai", code: "vendor_extension", status: 400 }],
      ["generic upstream error", { operatorId: "generic", status: 502 }],
    ]) {
      test(`${prefix}: ${name} switches once without caching`, async () => {
        const ctx = setup(operationKind, streaming, [upstream(facts)]);
        await ctx.run();
        await ctx.run();
        assert.deepEqual(ctx.calls, [streaming, !streaming, streaming]);
      });
      test(`${prefix}: repeated ${name} stops after two modes`, async () => {
        const first = upstream(facts);
        const last = upstream(facts);
        const ctx = setup(operationKind, streaming, [first, last]);
        await assert.rejects(ctx.run(), (error) => error === last);
        assert.deepEqual(ctx.calls, [streaming, !streaming]);
      });
    }
    test(`${prefix}: documented invalid prompt never changes mode`, async () => {
      const failure = upstream({ operatorId: "openai", code: "invalid_prompt", status: 400 });
      const ctx = setup(operationKind, streaming, [failure]);
      await assert.rejects(ctx.run(), (error) => error === failure);
      assert.deepEqual(ctx.calls, [streaming]);
    });
    test(`${prefix}: local unknown errors use existing transport retry without switching`, async () => {
      const ctx = setup(operationKind, streaming, [new Error("local failure")]);
      await ctx.run();
      assert.deepEqual(ctx.calls, [streaming, streaming]);
    });
    test(`${prefix}: mode change and documented transport retry share total budget`, async () => {
      const unknown = upstream({ operatorId: "generic", status: 520 });
      const limited = upstream({ operatorId: "openai", code: "rate_limit_exceeded", status: 429 });
      const ctx = setup(operationKind, streaming, [unknown, limited, limited], 3);
      await assert.rejects(ctx.run(), (error) => error === limited);
      assert.deepEqual(ctx.calls, [streaming, !streaming, !streaming]);
    });
    test(`${prefix}: exhausted total budget forbids mode change`, async () => {
      const failure = upstream({ operatorId: "generic", status: 520 });
      const ctx = setup(operationKind, streaming, [failure], 1);
      await assert.rejects(ctx.run(), (error) => error === failure);
      assert.deepEqual(ctx.calls, [streaming]);
    });
  }
}
