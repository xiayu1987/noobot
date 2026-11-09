/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import test from "node:test";
import assert from "node:assert/strict";

import { createAuthService } from "../services/auth-service.js";
import { createWebSocketAuthProtocols } from "@noobot/shared/websocket-auth";

test("auth-service: query API keys never authenticate", () => {
  const service = createAuthService({ translateText: (key) => key });
  const apiKey = service.issueApiKey({ userId: "u1", role: "user" });
  assert.equal(
    service.resolveAuthByApiKey({
      method: "GET",
      url: `/chat?apikey=${apiKey}`,
      query: { apikey: apiKey },
    }),
    null,
  );
});

test("auth-service: WebSocket subprotocol authenticates and rejects ambiguous credentials", () => {
  const service = createAuthService({ translateText: (key) => key });
  const apiKey = service.issueApiKey({ userId: "u1", role: "user" });
  const protocol = createWebSocketAuthProtocols(apiKey).join(", ");
  assert.equal(
    service.resolveAuthByApiKey({
      headers: {
        "sec-websocket-protocol": protocol,
      },
    })?.userId,
    "u1",
  );
  assert.equal(
    service.resolveAuthByApiKey({
      headers: {
        "sec-websocket-protocol": `${protocol}, ${protocol}`,
      },
    }),
    null,
  );
});

test("auth-service: malformed URL does not break header API key auth", () => {
  const service = createAuthService({
    translateText: (key = "") => String(key || ""),
  });
  const apiKey = service.issueApiKey({ userId: "u1", role: "user" });

  const auth = service.resolveAuthByApiKey({
    url: "http://[?apikey=SHOULD_NOT_BE_USED",
    headers: { "x-api-key": apiKey },
    query: {},
  });

  assert.deepEqual(auth?.userId, "u1");
});

test("auth-service: issueApiKey rejects non-canonical userId", () => {
  const service = createAuthService({ translateText: (key) => key });
  for (const userId of ["", " u1", undefined]) {
    assert.throws(() => service.issueApiKey({ userId, role: "user" }), TypeError);
  }
});

test("auth-service: requireApiKey forbids a mismatched body or query userId", () => {
  const service = createAuthService({ translateText: (key) => key });
  const apiKey = service.issueApiKey({ userId: "u1", role: "user" });
  let statusCode = 0;
  let nextCalled = false;
  const res = {
    status(code) {
      statusCode = code;
      return { json() {} };
    },
  };
  service.requireApiKey(
    {
      headers: { "x-api-key": apiKey },
      body: { userId: "u2" },
      query: {},
    },
    res,
    () => {
      nextCalled = true;
    },
  );
  assert.equal(nextCalled, false);
  assert.equal(statusCode, 403);
});
