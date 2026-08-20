/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import assert from "node:assert/strict";
import test from "node:test";
import { rateLimit } from "express-rate-limit";
import { createHttpAdmissionOptions } from "../security/http-admission.js";

function response(onComplete) {
  return {
    headers: {},
    statusCode: 0,
    body: null,
    setHeader(name, value) {
      this.headers[name] = value;
    },
    append(name, value) {
      const current = this.headers[name];
      this.headers[name] = current === undefined ? value : `${current}, ${value}`;
    },
    getHeader(name) {
      return this.headers[name];
    },
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(body) {
      this.body = body;
      onComplete?.();
      return this;
    },
  };
}

async function invoke(admission, request) {
  return new Promise((resolve, reject) => {
    let settled = false;
    let admitted = false;
    const complete = (res) => {
      if (settled) return;
      settled = true;
      resolve({ admitted, res });
    };
    const res = response(() => complete(res));
    admission(request, res, (error) => {
      if (error) {
        reject(error);
        return;
      }
      admitted = true;
      complete(res);
    });
  });
}

test("HTTP admission limits one authenticated identity without affecting another", async () => {
  const admission = rateLimit(
    createHttpAdmissionOptions({
      resolveAuthByApiKey: (req) => ({ userId: req.headers.user }),
      policies: {
        read: { limit: 2, windowMs: 1000 },
        mutation: { limit: 2, windowMs: 1000 },
        connection: { limit: 2, windowMs: 1000 },
      },
    }),
  );
  const request = (user) => ({
    method: "GET",
    path: "/internal/workspace/u",
    headers: { user },
    socket: {},
  });
  assert.equal((await invoke(admission, request("one"))).admitted, true);
  assert.equal((await invoke(admission, request("one"))).admitted, true);
  const rejected = await invoke(admission, request("one"));
  assert.equal(rejected.res.statusCode, 429);
  assert.equal(rejected.res.headers["Retry-After"], "1");
  assert.equal((await invoke(admission, request("two"))).admitted, true);
});

test("HTTP admission classifies connection requests and exempts health checks", async () => {
  const admission = rateLimit(
    createHttpAdmissionOptions({
      policies: {
        read: { limit: 1, windowMs: 1000 },
        mutation: { limit: 1, windowMs: 1000 },
        connection: { limit: 1, windowMs: 1000 },
      },
    }),
  );
  const request = {
    method: "POST",
    path: "/internal/connect",
    headers: {},
    socket: { remoteAddress: "127.0.0.1" },
  };
  assert.equal((await invoke(admission, request)).admitted, true);
  assert.equal((await invoke(admission, request)).res.statusCode, 429);
  assert.equal((await invoke(admission, { ...request, path: "/health" })).admitted, true);
});
