/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import assert from "node:assert/strict";
import test from "node:test";
import { closeRuntimeResources } from "../bootstrap/close-runtime-resources.js";

test("shutdown keeps connectors alive until bot operations drain and flushes last", async () => {
  const calls = [];
  const gate = Promise.withResolvers();
  const admitted = Promise.withResolvers();
  const closing = closeRuntimeResources({
    stopManagedInstances: () => calls.push("managed"),
    closeHttp: () => calls.push("http"),
    closeBot: async () => {
      calls.push("bot");
      admitted.resolve();
      await gate.promise;
    },
    releaseConnectors: () => calls.push("connectors"),
    flushEvents: () => calls.push("flush"),
  });
  await admitted.promise;
  assert.deepEqual(calls, ["managed", "http", "bot"]);
  gate.resolve();
  await closing;
  assert.deepEqual(calls, ["managed", "http", "bot", "connectors", "flush"]);
});

test("every resource release is attempted and all synchronous and asynchronous failures remain visible", async () => {
  const errors = Array.from({ length: 5 }, (_, i) => new Error(`close ${i}`));
  const calls = [];
  const operations = errors.map((error, i) => () => {
    calls.push(i);
    if (i % 2 === 0) throw error;
    return Promise.reject(error);
  });
  const [stopManagedInstances, closeHttp, closeBot, releaseConnectors, flushEvents] = operations;
  await assert.rejects(
    closeRuntimeResources({
      stopManagedInstances,
      closeHttp,
      closeBot,
      releaseConnectors,
      flushEvents,
    }),
    (cause) => {
      assert.ok(cause instanceof AggregateError);
      assert.deepEqual(cause.errors, errors);
      return true;
    },
  );
  assert.deepEqual(calls, [0, 1, 2, 3, 4]);
});
