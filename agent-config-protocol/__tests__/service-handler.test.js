/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import assert from "node:assert/strict";
import test from "node:test";
import {
  SERVICE_FAILURE_CODE,
  normalizeServiceHandlerResult,
  resolveServiceHandler,
} from "../src/contract/service-handler.js";

test("service handler success carries only an object output", () => {
  assert.deepEqual(normalizeServiceHandlerResult({ ok: true, output: { httpStatus: 200 } }), {
    ok: true,
    output: { httpStatus: 200 },
  });
  assert.throws(() => normalizeServiceHandlerResult({ ok: true }), /output must be an object/);
  assert.throws(
    () => normalizeServiceHandlerResult({ ok: true, output: {}, status: 200 }),
    /unsupported field: status/,
  );
});

test("service handler failure requires error and a named code", () => {
  const failure = {
    ok: false,
    error: "upstream returned 503",
    code: SERVICE_FAILURE_CODE.UPSTREAM_FAILED,
    output: { httpStatus: 503 },
  };
  assert.deepEqual(normalizeServiceHandlerResult(failure), failure);
  assert.throws(
    () => normalizeServiceHandlerResult({ ok: false, code: SERVICE_FAILURE_CODE.INPUT_INVALID }),
    /failure error is required/,
  );
  assert.throws(
    () => normalizeServiceHandlerResult({ ok: false, error: "x", code: 500 }),
    /failure code is invalid/,
  );
});

test("service handler result rejects non-objects and missing ok", () => {
  assert.throws(() => normalizeServiceHandlerResult("text"), /must be an object/);
  assert.throws(() => normalizeServiceHandlerResult({ output: {} }), /ok must be boolean/);
});

test("service handler module must default-export a function", () => {
  const handler = async () => ({ ok: true, output: {} });
  assert.equal(resolveServiceHandler({ default: handler }), handler);
  assert.throws(() => resolveServiceHandler({ named: handler }), /default-export a function/);
});
