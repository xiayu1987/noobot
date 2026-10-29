/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import test from "node:test";
import assert from "node:assert/strict";
import {
  API_REQUEST_ERROR_CODE,
  ApiRequestError,
  isApiRequestError,
  isApiRequestNotFound,
  readApiResponseEnvelope,
} from "../request-error.js";

test("ApiRequestError carries code, status and cause", () => {
  const cause = new TypeError("offline");
  const error = new ApiRequestError("failed", {
    code: API_REQUEST_ERROR_CODE.NETWORK,
    status: null,
    cause,
  });
  assert.equal(error.name, "ApiRequestError");
  assert.equal(error.code, "network");
  assert.equal(error.status, null);
  assert.equal(error.cause, cause);
  assert.equal(isApiRequestError(error), true);
  assert.equal(isApiRequestNotFound(error), false);
});

test("ApiRequestError rejects unknown codes and non-integer status", () => {
  assert.throws(() => new ApiRequestError("x", { code: "other", status: null }), TypeError);
  assert.throws(
    () => new ApiRequestError("x", { code: API_REQUEST_ERROR_CODE.HTTP, status: "500" }),
    TypeError,
  );
});

test("isApiRequestNotFound only matches the not_found code", () => {
  const missing = new ApiRequestError("missing", {
    code: API_REQUEST_ERROR_CODE.NOT_FOUND,
    status: 200,
  });
  assert.equal(isApiRequestNotFound(missing), true);
  assert.equal(isApiRequestError(new Error("plain")), false);
  assert.equal(isApiRequestNotFound(new TypeError("bug")), false);
});

function jsonResponse(body, status = 200, headers = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...headers, "content-type": "application/json; charset=utf-8" },
  });
}

test("readApiResponseEnvelope returns a 2xx ok:true payload", async () => {
  assert.deepEqual(await readApiResponseEnvelope(jsonResponse({ ok: true, value: 1 })), {
    ok: true,
    value: 1,
  });
});

test("readApiResponseEnvelope maps a failure envelope to an http ApiRequestError", async () => {
  const response = jsonResponse({ ok: false, error: "conflict", errorCode: "VERSION" }, 409);
  await assert.rejects(readApiResponseEnvelope(response), (error) => {
    assert.equal(isApiRequestError(error), true);
    assert.equal(error.code, API_REQUEST_ERROR_CODE.HTTP);
    assert.equal(error.status, 409);
    assert.equal(error.message, "conflict");
    assert.equal(error.serverErrorCode, "VERSION");
    return true;
  });
});

test("ApiRequestError rejects the http code for status 404", () => {
  assert.throws(
    () => new ApiRequestError("x", { code: API_REQUEST_ERROR_CODE.HTTP, status: 404 }),
    TypeError,
  );
});

test("readApiResponseEnvelope maps http 404 to the not_found code", async () => {
  const response = jsonResponse({ ok: false, error: "missing" }, 404);
  await assert.rejects(readApiResponseEnvelope(response), (error) => {
    assert.equal(isApiRequestNotFound(error), true);
    assert.equal(error.status, 404);
    assert.equal(error.message, "missing");
    return true;
  });
});

test("readApiResponseEnvelope reports a non-json failure by its status", async () => {
  const response = new Response("<html>bad gateway</html>", { status: 502 });
  await assert.rejects(readApiResponseEnvelope(response), (error) => {
    assert.equal(error.code, API_REQUEST_ERROR_CODE.HTTP);
    assert.equal(error.status, 502);
    assert.equal(error.serverErrorCode, "");
    return true;
  });
});

test("readApiResponseEnvelope treats envelope violations as contract errors", async () => {
  await assert.rejects(readApiResponseEnvelope(jsonResponse({ ok: false, error: "x" })), TypeError);
  await assert.rejects(readApiResponseEnvelope(jsonResponse({ value: 1 })), TypeError);
  await assert.rejects(readApiResponseEnvelope(jsonResponse({ ok: false }, 500)), TypeError);
  await assert.rejects(
    readApiResponseEnvelope(jsonResponse({ ok: false, error: "x", errorCode: 7 }, 500)),
    TypeError,
  );
});

test("readApiResponseEnvelope carries retry-after milliseconds only for http 429", async () => {
  const limited = jsonResponse({ ok: false, error: "slow down" }, 429, { "retry-after": "2" });
  await assert.rejects(readApiResponseEnvelope(limited), (error) => {
    assert.equal(error.status, 429);
    assert.equal(error.retryAfterMs, 2000);
    return true;
  });
  const conflict = jsonResponse({ ok: false, error: "conflict" }, 409, { "retry-after": "2" });
  await assert.rejects(readApiResponseEnvelope(conflict), (error) => {
    assert.equal(Object.hasOwn(error, "retryAfterMs"), false);
    return true;
  });
});

test("http 429 without a positive retry-after violates the contract", async () => {
  for (const headers of [{}, { "retry-after": "0" }, { "retry-after": "soon" }]) {
    await assert.rejects(
      readApiResponseEnvelope(jsonResponse({ ok: false, error: "slow down" }, 429, headers)),
      TypeError,
    );
  }
  assert.throws(
    () => new ApiRequestError("x", { code: API_REQUEST_ERROR_CODE.HTTP, status: 429 }),
    TypeError,
  );
  assert.throws(
    () =>
      new ApiRequestError("x", {
        code: API_REQUEST_ERROR_CODE.HTTP,
        status: 500,
        retryAfterMs: 1000,
      }),
    TypeError,
  );
});

test("readApiResponseEnvelope carries the failure envelope currentVersion", async () => {
  const response = jsonResponse(
    {
      ok: false,
      error: "conflict",
      errorCode: "SESSION_AGGREGATE_VERSION_CONFLICT",
      currentVersion: 7,
    },
    409,
  );
  await assert.rejects(readApiResponseEnvelope(response), (error) => {
    assert.equal(error.status, 409);
    assert.equal(error.serverErrorCode, "SESSION_AGGREGATE_VERSION_CONFLICT");
    assert.equal(error.currentVersion, 7);
    return true;
  });
  const withoutVersion = jsonResponse({ ok: false, error: "conflict" }, 409);
  await assert.rejects(readApiResponseEnvelope(withoutVersion), (error) => {
    assert.equal(Object.hasOwn(error, "currentVersion"), false);
    return true;
  });
});

test("failure envelope with a non-integer currentVersion violates the contract", async () => {
  for (const currentVersion of [-1, 1.5, "7", null]) {
    await assert.rejects(
      readApiResponseEnvelope(jsonResponse({ ok: false, error: "conflict", currentVersion }, 409)),
      TypeError,
    );
  }
});

test("ApiRequestError validates the optional currentVersion", () => {
  const error = new ApiRequestError("x", {
    code: API_REQUEST_ERROR_CODE.HTTP,
    status: 409,
    currentVersion: 0,
  });
  assert.equal(error.currentVersion, 0);
  for (const currentVersion of [-1, 1.5, "7", null]) {
    assert.throws(
      () =>
        new ApiRequestError("x", {
          code: API_REQUEST_ERROR_CODE.HTTP,
          status: 409,
          currentVersion,
        }),
      TypeError,
    );
  }
});
