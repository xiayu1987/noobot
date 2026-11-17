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

test("createDetachedSubSessionRunner requires userId and parentSessionId", async () => {
  const { deps } = createDeps();
  const runner = createDetachedSubSessionRunner(deps);
  await assert.rejects(
    () =>
      runner({
        attachments: [],
        abortSignal: new AbortController().signal,
        parentExecutionScope: createParentExecutionScope(),
        strategy: { userId: "u1" },
      }),
    /sub-session runner requires userId and parentSessionId/,
  );
});

test("createDetachedSubSessionRunner aborts before execution when signal is already aborted", async () => {
  let runCalled = false;
  const controller = new AbortController();
  controller.abort();
  const { deps } = createDeps({
    sessionRunner: {
      async runSession() {
        runCalled = true;
      },
    },
  });
  const runner = createDetachedSubSessionRunner(deps);
  await assert.rejects(
    () =>
      runner({
        attachments: [],
        parentExecutionScope: createParentExecutionScope(),
        abortSignal: controller.signal,
        strategy: createCompleteStrategy(),
      }),
    (error) => error === controller.signal.reason,
  );
  assert.equal(runCalled, false);
});

test("createDetachedSubSessionRunner propagates user config loading failures", async () => {
  const { deps } = createDeps({
    configService: {
      async loadUserConfig() {
        throw new Error("config unavailable");
      },
    },
  });
  const runner = createDetachedSubSessionRunner(deps);
  await assert.rejects(
    () =>
      runner({
        attachments: [],
        abortSignal: new AbortController().signal,
        parentExecutionScope: createParentExecutionScope(),
        metadata: DETACHED_REQUEST_METADATA,
        strategy: createCompleteStrategy(),
      }),
    /config unavailable/,
  );
});
