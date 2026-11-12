/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import test from "node:test";
import assert from "node:assert/strict";
import { resolveErrorDetails, resolveErrorMessage } from "../../../src/shared/utils/error-utils.js";
import { resolveErrorHeaderValue } from "../../../src/shared/utils/error-header.js";

function unexpectedRead() {
  assert.fail("lower-priority field must not be read");
}

test("error details stop reading each field at its authoritative source", () => {
  const error = {
    status: 401,
    code: "PRIMARY",
    type: "primary_error",
    request_id: "req-primary",
    get error() {
      return unexpectedRead();
    },
    get response() {
      return unexpectedRead();
    },
    get cause() {
      return unexpectedRead();
    },
    get headers() {
      return unexpectedRead();
    },
  };
  assert.deepEqual(resolveErrorDetails(error), {
    status: 401,
    code: "PRIMARY",
    type: "primary_error",
    requestId: "req-primary",
  });
});

test("status source precedence is preserved for every adjacent pair", () => {
  const sources = [
    (status) => ({ status }),
    (status) => ({ statusCode: status }),
    (status) => ({ error: { status } }),
    (status) => ({ response: { status } }),
    (status) => ({ cause: { status } }),
    (status) => ({ cause: { statusCode: status } }),
    (status) => ({ cause: { error: { status } } }),
  ];
  for (const [index, source] of sources.entries()) {
    assert.equal(resolveErrorDetails(source("429")).status, 429);
    const next = sources[index + 1];
    if (!next) continue;
    for (const status of [401, 0, false, "invalid"]) {
      const higher = source(status);
      const lower = next(503);
      const error = {
        ...lower,
        ...higher,
        cause: { ...lower.cause, ...higher.cause },
      };
      assert.equal(resolveErrorDetails(error).status, status === 401 ? 401 : undefined);
    }
  }
});

test("detail values preserve false and zero without reading lower-priority values", () => {
  assert.deepEqual(resolveErrorDetails({ code: 0, type: false }), {
    status: undefined,
    code: 0,
    type: false,
    requestId: undefined,
  });
});

test("message resolution stops before unused structured sources and identities", () => {
  assert.equal(
    resolveErrorMessage({
      message: " primary ",
      get error() {
        return unexpectedRead();
      },
    }),
    "primary",
  );
  assert.equal(
    resolveErrorMessage({
      type: "primary_type",
      get code() {
        return unexpectedRead();
      },
    }),
    "primary_type",
  );
  assert.equal(
    resolveErrorMessage({
      response: { data: { error: "response failure" } },
      get cause() {
        return unexpectedRead();
      },
    }),
    "response failure",
  );
});

test("structured messages precede identities and retain source order", () => {
  const error = {
    message: "primary",
    error: { message: "nested" },
    response: { data: { error: { message: "response nested" }, message: "response" } },
    cause: { message: "cause", error: { message: "cause nested" }, type: "cause_type" },
    type: "primary_type",
  };
  for (const [source, expected] of [
    [error, "primary"],
    [error.error, "nested"],
    [error.response.data.error, "response nested"],
    [error.response.data, "response"],
    [error.cause, "cause"],
    [error.cause.error, "cause nested"],
  ]) {
    assert.equal(resolveErrorMessage(error), expected);
    delete source.message;
  }
  assert.equal(resolveErrorMessage(error), "primary_type");
  delete error.type;
  assert.equal(resolveErrorMessage(error), "cause_type");
  for (const value of [0, false])
    assert.equal(resolveErrorMessage({ message: value }), String(value));
});

test("error headers use case-insensitive lookup for objects and Headers", () => {
  for (const headers of [
    { "X-Request-Id": "req-1" },
    { "x-request-id": "req-1" },
    new Headers({ "X-Request-Id": "req-1" }),
  ]) {
    assert.equal(resolveErrorHeaderValue(headers, " X-REQUEST-ID "), "req-1");
    assert.equal(resolveErrorDetails({ response: { headers } }).requestId, "req-1");
  }
  assert.equal(
    resolveErrorHeaderValue(Object.create({ "x-request-id": "inherited" }), "x-request-id"),
    undefined,
  );
});

test("Headers readers run once and preserve present empty values", () => {
  for (const value of [null, "", "req-1"]) {
    let calls = 0;
    const headers = {
      get(name) {
        calls += 1;
        assert.equal(name, "x-request-id");
        return value;
      },
    };
    assert.equal(resolveErrorHeaderValue(headers, "X-Request-Id"), value ?? undefined);
    assert.equal(calls, 1);
  }
});
