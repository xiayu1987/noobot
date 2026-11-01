/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import test from "node:test";
import assert from "node:assert/strict";
import { createDetachedSubSessionRunner } from "../../src/bot/session/detached-subsession-runner.js";
import {
  DETACHED_REQUEST_METADATA,
  createCompleteStrategy,
  createDeps,
  createParentExecutionScope,
} from "./detached-subsession-runner.test-helpers.js";

function createRequest(fields = {}) {
  return {
    abortSignal: new AbortController().signal,
    parentExecutionScope: createParentExecutionScope(),
    message: "hello",
    attachments: [],
    metadata: DETACHED_REQUEST_METADATA,
    strategy: createCompleteStrategy(),
    ...fields,
  };
}

test("an omitted system message factory explicitly means no additional system messages", async () => {
  const { deps, calls } = createDeps();
  await createDetachedSubSessionRunner(deps)(createRequest());
  assert.deepEqual(calls.runSessionPayloads[0].systemMessages, []);
});

test("an asynchronous system message factory retains its returned array reference", async () => {
  const { deps, calls } = createDeps();
  const messages = ["system"];
  await createDetachedSubSessionRunner(deps)(
    createRequest({
      systemMessageFactory: async ({ attachments }) => {
        assert.deepEqual(attachments, []);
        return messages;
      },
    }),
  );
  assert.equal(calls.runSessionPayloads[0].systemMessages, messages);
});

test("invalid system message factories reject before lifecycle, metadata or execution writes", async () => {
  for (const systemMessageFactory of [null, false, "factory", {}]) {
    const { deps, calls } = createDeps();
    await assert.rejects(
      createDetachedSubSessionRunner(deps)(createRequest({ systemMessageFactory })),
      /systemMessageFactory must be a function/,
    );
    assert.deepEqual(calls.lifecyclePayloads, []);
    assert.deepEqual(calls.metadataWrites, []);
    assert.deepEqual(calls.runSessionPayloads, []);
  }
});

test("invalid factory results reject before lifecycle, metadata or execution writes", async () => {
  for (const result of [undefined, null, false, "system", {}]) {
    const { deps, calls } = createDeps();
    await assert.rejects(
      createDetachedSubSessionRunner(deps)(
        createRequest({
          systemMessageFactory: async () => result,
        }),
      ),
      /systemMessageFactory must return an array/,
    );
    assert.deepEqual(calls.lifecyclePayloads, []);
    assert.deepEqual(calls.metadataWrites, []);
    assert.deepEqual(calls.runSessionPayloads, []);
  }
});

test("a factory failure preserves the original error before lifecycle and execution writes", async () => {
  const { deps, calls } = createDeps();
  const error = new Error("system message generation failed");
  await assert.rejects(
    createDetachedSubSessionRunner(deps)(
      createRequest({
        systemMessageFactory: async () => {
          throw error;
        },
      }),
    ),
    (actual) => actual === error,
  );
  assert.deepEqual(calls.lifecyclePayloads, []);
  assert.deepEqual(calls.metadataWrites, []);
  assert.deepEqual(calls.runSessionPayloads, []);
});
