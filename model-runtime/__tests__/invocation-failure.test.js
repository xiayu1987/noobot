/* Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import test from "node:test";
import assert from "node:assert/strict";
import { createModelRequestExecutor } from "../src/index.js";
import {
  MODEL_CONTEXT_SEQUENCE_POLICY,
  MODEL_ERROR_KIND,
  MODEL_INVOCATION_EVENT,
  MODEL_OPERATION_KIND,
  MODEL_RESPONSE_SOURCE,
  ModelProtocolError,
} from "@noobot/model-protocol";

const invocation = {
  requestId: "r",
  invocationId: "i",
  sessionId: "s",
  parentSessionId: "",
  dialogProcessId: "d",
  turnScopeId: "t",
  runId: "run",
  flow: "test",
  purpose: "test",
  domain: "test",
  contextSequencePolicy: MODEL_CONTEXT_SEQUENCE_POLICY.INDEPENDENT_REQUEST,
};
const request = {
  invocation,
  model: {
    model: "m",
    operatorId: "test",
    adapterId: "openai-compatible",
    capabilities: { web_search: true },
  },
  messages: [],
};
const terminalTypes = [
  MODEL_INVOCATION_EVENT.COMPLETED,
  MODEL_INVOCATION_EVENT.FAILED,
  MODEL_INVOCATION_EVENT.CANCELLED,
];
function harness({
  adapter: overrides = {},
  credentialPort = { resolve: () => "secret" },
  clientDecorator = null,
} = {}) {
  const events = [];
  const adapter = {
    id: "openai-compatible",
    resolveResponseSource: () => MODEL_RESPONSE_SOURCE.MESSAGE,
    classifyError: () => ({ kind: MODEL_ERROR_KIND.AUTHENTICATION }),
    createClient: () => ({ invoke: async () => ({ content: "ok" }) }),
    bindTools: ({ client }) => client,
    prepareMessages: ({ messages }) => messages,
    ...overrides,
  };
  const executor = createModelRequestExecutor({
    registry: { resolve: () => adapter },
    credentialPort,
    clientDecorator,
    observationPort: { emit: (type, payload) => events.push({ type, payload }) },
    clock: { now: () => 0, sleep: async () => {} },
  });
  return {
    executor,
    events,
    terminals: () => events.filter(({ type }) => terminalTypes.includes(type)),
  };
}

for (const stage of [
  "credential",
  "createClient",
  "clientDecorator",
  "responseSource",
  "unsupportedOperation",
]) {
  test(`${stage} failure emits one terminal failure without inventing an attempt`, async () => {
    const original = new Error(stage);
    const fail = () => {
      throw original;
    };
    const options = {
      credentialPort: stage === "credential" ? { resolve: fail } : { resolve: () => "secret" },
      clientDecorator: stage === "clientDecorator" ? fail : null,
      adapter: {
        ...(stage === "createClient" ? { createClient: fail } : {}),
        ...(stage === "responseSource" ? { resolveResponseSource: fail } : {}),
      },
    };
    const h = harness(options);
    await assert.rejects(
      h.executor.invoke({
        ...request,
        ...(stage === "unsupportedOperation"
          ? { operation: { kind: MODEL_OPERATION_KIND.WEB_SEARCH, input: { query: "q" } } }
          : {}),
      }),
      stage === "unsupportedOperation"
        ? /does not support operation/
        : (error) => error === original,
    );
    assert.equal(h.terminals().length, 1);
    assert.equal(h.terminals()[0].type, MODEL_INVOCATION_EVENT.FAILED);
    assert.equal(h.terminals()[0].payload.attemptCount, 0);
    assert.deepEqual(h.terminals()[0].payload.failedAttempts, []);
  });
}

test("normalization protocol error records a failed response attempt and rethrows the typed error", async () => {
  const h = harness({ adapter: { resolveResponseSource: () => MODEL_RESPONSE_SOURCE.RESPONSES } });
  await assert.rejects(h.executor.invoke(request), ModelProtocolError);
  assert.equal(h.terminals().length, 1);
  const { payload } = h.terminals()[0];
  assert.equal(payload.attemptCount, 1);
  assert.equal(payload.failedAttempts.length, 1);
  assert.equal(payload.failedAttempts[0].kind, "response");
  assert.equal(payload.failedAttempts[0].error.code, "MODEL_PROTOCOL_ERROR");
});

test("transport exhaustion preserves each attempt error instead of filling from terminal error", async () => {
  let calls = 0;
  const errors = [
    Object.assign(new Error("first"), { code: "FIRST" }),
    Object.assign(new Error("second"), { code: "SECOND" }),
  ];
  const h = harness({
    adapter: {
      classifyError: () => ({ kind: MODEL_ERROR_KIND.RATE_LIMIT }),
      createClient: () => ({
        invoke: async () => {
          throw errors[calls++];
        },
      }),
    },
  });
  await assert.rejects(
    h.executor.invoke({
      ...request,
      policies: { retry: { transport: { maxAttempts: 2, baseDelayMs: 0 } } },
      options: { callbacks: [{ handleLLMNewToken() {} }] },
    }),
    (error) => error === errors[1],
  );
  assert.equal(h.terminals().length, 1);
  assert.deepEqual(
    h.terminals()[0].payload.failedAttempts.map(({ error }) => error.code),
    ["FIRST", "SECOND"],
  );
  const { payload } = h.terminals()[0];
  assert.equal(payload.message, "second");
  assert.deepEqual(
    payload.failedAttempts.map(({ error }) => error),
    [
      {
        message: "first",
        code: "FIRST",
        kind: MODEL_ERROR_KIND.RATE_LIMIT,
        classificationError: null,
      },
      {
        message: "second",
        code: "SECOND",
        kind: MODEL_ERROR_KIND.RATE_LIMIT,
        classificationError: null,
      },
    ],
  );
});

test("classification failure is explicit, never retries, and preserves the original exception", async () => {
  const original = new Error("provider failure");
  let calls = 0;
  const h = harness({
    adapter: {
      classifyError: () => {
        throw new Error("classifier broken");
      },
      createClient: () => ({
        invoke: async () => {
          calls++;
          throw original;
        },
      }),
    },
  });
  await assert.rejects(h.executor.invoke(request), (error) => error === original);
  assert.equal(calls, 1);
  assert.equal(h.terminals().length, 1);
  const { payload } = h.terminals()[0];
  assert.equal(payload.kind, MODEL_ERROR_KIND.CLASSIFICATION);
  assert.equal(payload.classificationError, "classifier broken");
  assert.equal(payload.failedAttempts[0].error.classificationError, "classifier broken");
});

test("transport retry followed by success emits only completed and retains the failed attempt", async () => {
  let calls = 0;
  const h = harness({
    adapter: {
      classifyError: () => ({ kind: MODEL_ERROR_KIND.TIMEOUT }),
      createClient: () => ({
        invoke: async () => {
          if (++calls === 1) throw new Error("timeout");
          return { content: "ok" };
        },
      }),
    },
  });
  const response = await h.executor.invoke({
    ...request,
    policies: { retry: { transport: { maxAttempts: 2, baseDelayMs: 0 } } },
  });
  assert.equal(h.terminals().length, 1);
  assert.equal(h.terminals()[0].type, MODEL_INVOCATION_EVENT.COMPLETED);
  assert.deepEqual(
    response.execution.attempts.map(({ status }) => status),
    ["failed", "completed"],
  );
});

test("cancelled invocation emits only cancelled and rethrows the frozen reason", async () => {
  const controller = new AbortController();
  const reason = Object.freeze({ kind: "execution_abort" });
  let classificationCalls = 0;
  const h = harness({
    adapter: {
      classifyError: () => {
        classificationCalls++;
        throw new Error("cancellation must not enter failure classification");
      },
      createClient: () => ({
        invoke: async () => {
          controller.abort(reason);
          throw reason;
        },
      }),
    },
  });
  await assert.rejects(
    h.executor.invoke({ ...request, options: { signal: controller.signal } }),
    (error) => error === reason,
  );
  assert.equal(h.terminals().length, 1);
  assert.equal(h.terminals()[0].type, MODEL_INVOCATION_EVENT.CANCELLED);
  assert.equal(h.terminals()[0].payload.attemptCount, 1);
  assert.equal(classificationCalls, 0);
});

test("provider-classified abort emits cancelled without scheduling a retry", async () => {
  const original = new Error("provider cancelled");
  let calls = 0;
  const h = harness({
    adapter: {
      classifyError: () => ({ kind: MODEL_ERROR_KIND.ABORTED }),
      createClient: () => ({
        invoke: async () => {
          calls++;
          throw original;
        },
      }),
    },
  });
  await assert.rejects(h.executor.invoke(request), (error) => error === original);
  assert.equal(calls, 1);
  assert.equal(h.terminals().length, 1);
  assert.equal(h.terminals()[0].type, MODEL_INVOCATION_EVENT.CANCELLED);
  assert.equal(h.events.filter(({ type }) => type.includes("retry")).length, 0);
});

test("operation transport failure records its attempt and emits one failed event", async () => {
  const original = new Error("operation rejected");
  const h = harness({
    adapter: {
      executeOperation: async () => {
        throw original;
      },
      resolveOperationStreamingModes: () => [false],
    },
  });
  await assert.rejects(
    h.executor.invoke({
      ...request,
      operation: { kind: MODEL_OPERATION_KIND.WEB_SEARCH, input: { query: "q" } },
    }),
    (error) => error === original,
  );
  assert.equal(h.terminals().length, 1);
  assert.equal(h.terminals()[0].payload.failedAttempts[0].kind, "transport");
});
