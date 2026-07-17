/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import test from "node:test";
import assert from "node:assert/strict";

import { AsyncSessionRunner } from "../../../src/system-core/bot-manage/async/session-runner.js";

const USER_ID = "user-1";
const PARENT_SESSION_ID = "11111111-1111-4111-8111-111111111111";
const SESSION_ID = "22222222-2222-4222-8222-222222222222";

test("AsyncSessionRunner marks only explicit user_stop abort as user_stopped", async () => {
  const abortController = new AbortController();
  abortController.abort({ type: "system_abort", reason: "upstream closed" });
  const jobs = new Map();
  const runner = new AsyncSessionRunner({
    jobs,
    runSession: async () => {
      const error = new Error("aborted by upstream");
      error.name = "AbortError";
      throw error;
    },
  });

  runner.runAsyncSession({
    userId: USER_ID,
    parentSessionId: PARENT_SESSION_ID,
    sessionId: SESSION_ID,
    abortSignal: abortController.signal,
  });

  await assert.rejects(jobs.get(`${PARENT_SESSION_ID}::${SESSION_ID}`)?.promise, /aborted by upstream/);
  assert.equal(jobs.get(`${PARENT_SESSION_ID}::${SESSION_ID}`)?.status, "failed");
});

test("AsyncSessionRunner preserves explicit user_stop abort status", async () => {
  const abortController = new AbortController();
  abortController.abort({ type: "user_stop", reason: "user stop action" });
  const jobs = new Map();
  const runner = new AsyncSessionRunner({
    jobs,
    runSession: async () => {
      const error = new Error("aborted by user");
      error.name = "AbortError";
      throw error;
    },
  });

  runner.runAsyncSession({
    userId: USER_ID,
    parentSessionId: PARENT_SESSION_ID,
    sessionId: SESSION_ID,
    abortSignal: abortController.signal,
  });

  await assert.rejects(jobs.get(`${PARENT_SESSION_ID}::${SESSION_ID}`)?.promise, /aborted by user/);
  assert.equal(jobs.get(`${PARENT_SESSION_ID}::${SESSION_ID}`)?.status, "user_stopped");
});
