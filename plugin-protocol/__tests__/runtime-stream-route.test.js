/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import assert from "node:assert/strict";
import test from "node:test";
import { invokeRuntimeStreamRoute } from "../src/frontend.js";

test("runtime stream routes return explicit handling decisions and receive the original context", () => {
  const input = Object.freeze({ envelope: {}, descriptor: {}, context: {} });
  for (const handled of [false, true]) {
    assert.equal(
      invokeRuntimeStreamRoute((received) => {
        assert.equal(received, input);
        return handled;
      }, input),
      handled,
    );
  }
});

test("invalid routes and implicit or asynchronous handling decisions are rejected", () => {
  for (const route of [undefined, null, {}, false]) {
    assert.throws(() => invokeRuntimeStreamRoute(route, {}), /invalid_runtime_stream_route/);
  }
  for (const value of [undefined, null, 0, 1, "true", {}, Promise.resolve(true)]) {
    assert.throws(
      () => invokeRuntimeStreamRoute(() => value, {}),
      /invalid_runtime_stream_route_result/,
    );
  }
});

test("runtime stream route failures retain the original error", () => {
  const failure = new Error("projection rejected");
  assert.throws(
    () =>
      invokeRuntimeStreamRoute(() => {
        throw failure;
      }, {}),
    (error) => error === failure,
  );
});
