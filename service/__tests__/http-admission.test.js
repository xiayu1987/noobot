/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import assert from "node:assert/strict";
import test from "node:test";
import { createHttpAdmission } from "../security/http-admission.js";

function response() {
  return {
    headers: {},
    statusCode: 0,
    body: null,
    set(name, value) {
      this.headers[name] = value;
    },
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(body) {
      this.body = body;
      return this;
    },
  };
}

function invoke(admission, request) {
  const res = response();
  let admitted = false;
  admission.middleware(request, res, () => {
    admitted = true;
  });
  return { admitted, res };
}

test("HTTP admission limits one authenticated identity without affecting another", () => {
  const admission = createHttpAdmission({
    resolveAuthByApiKey: (req) => ({ userId: req.headers.user }),
    policies: {
      read: { limit: 2, windowMs: 1000 },
      mutation: { limit: 2, windowMs: 1000 },
      connection: { limit: 2, windowMs: 1000 },
    },
    now: () => 100,
  });
  const request = (user) => ({
    method: "GET",
    path: "/internal/workspace/u",
    headers: { user },
    socket: {},
  });
  assert.equal(invoke(admission, request("one")).admitted, true);
  assert.equal(invoke(admission, request("one")).admitted, true);
  const rejected = invoke(admission, request("one"));
  assert.equal(rejected.res.statusCode, 429);
  assert.equal(rejected.res.headers["Retry-After"], "1");
  assert.equal(invoke(admission, request("two")).admitted, true);
});

test("HTTP admission resets expired windows and exempts health checks", () => {
  let timestamp = 0;
  const admission = createHttpAdmission({
    policies: {
      read: { limit: 1, windowMs: 1000 },
      mutation: { limit: 1, windowMs: 1000 },
      connection: { limit: 1, windowMs: 1000 },
    },
    now: () => timestamp,
  });
  const request = {
    method: "POST",
    path: "/internal/connect",
    headers: {},
    socket: { remoteAddress: "127.0.0.1" },
  };
  assert.equal(invoke(admission, request).admitted, true);
  assert.equal(invoke(admission, request).res.statusCode, 429);
  timestamp = 1000;
  assert.equal(invoke(admission, request).admitted, true);
  assert.equal(invoke(admission, { ...request, path: "/health" }).admitted, true);
});
