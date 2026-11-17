/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import assert from "node:assert/strict";
import test from "node:test";
import { EXECUTION_LOG_MAX_PENDING_RECORDS } from "@noobot/session-protocol";
import { createExecutionEventListener } from "../../src/events/execution-listener.js";

test("delivery and diagnostic admission failures drain accepted work and preserve later delivery", async () => {
  const started = Promise.withResolvers();
  const release = Promise.withResolvers();
  const persisted = [];
  const delivered = [];
  const route = {
    userId: "u1",
    sessionId: "s1",
    parentSessionId: "",
    dialogProcessId: "d1",
    turnScopeId: "t1",
  };
  const listener = createExecutionEventListener({
    ...route,
    persistenceScope: null,
    now: () => "2026-11-15T00:00:00.000Z",
    sessionManager: {
      async appendExecutionLogs({ records }) {
        started.resolve();
        await release.promise;
        persisted.push(...records);
      },
    },
    upstream: {
      async onEvent({ data }) {
        delivered.push(data.presentationMessageId);
        return data.presentationMessageId !== "failed";
      },
    },
  });
  for (let sequence = 0; sequence < EXECUTION_LOG_MAX_PENDING_RECORDS; sequence += 1) {
    listener.onEvent({ event: "batch_test", data: { sequence } });
  }
  await started.promise;
  assert.equal(
    await listener.forwardEvent({
      event: "message",
      data: { presentationMessageId: "failed" },
      route,
    }),
    false,
  );
  await listener.forwardEvent({ event: "message", data: { presentationMessageId: "next" }, route });
  assert.deepEqual(delivered, ["failed", "next"]);
  let completed = false;
  const flush = assert
    .rejects(listener.flush(), (error) => {
      assert.equal(error.code, "EXECUTION_EVENT_FLUSH_FAILED");
      assert.deepEqual(
        error.errors.map(({ code }) => code),
        ["EVENT_UPSTREAM_DELIVERY_FAILED", "EXECUTION_LOG_PERSISTENCE_FAILED"],
      );
      assert.equal(error.errors[1].cause.code, "EXECUTION_LOG_BACKPRESSURE_REQUIRED");
      return true;
    })
    .then(() => {
      completed = true;
    });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(completed, false);
  release.resolve();
  await flush;
  assert.equal(persisted.length, EXECUTION_LOG_MAX_PENDING_RECORDS);
});
