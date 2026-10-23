/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import test from "node:test";
import assert from "node:assert/strict";

process.env.AGENT_PROXY_UPSTREAM_HTTP_BASE = "http://127.0.0.1:1";

function createMockResponse() {
  return {
    statusCode: 0,
    body: "",
    writeHead(statusCode) {
      this.statusCode = statusCode;
    },
    end(body) {
      this.body = body;
    },
  };
}

async function interceptWithUpstream({ status, body }) {
  const previousFetch = globalThis.fetch;
  globalThis.fetch = async () =>
    new Response(JSON.stringify(body), {
      status,
      headers: { "content-type": "application/json" },
    });
  const saved = [];
  try {
    const { interceptConnectRequest } = await import(
      `../../src/http/connect-interceptor.js?upstream=${status}-${Date.now()}`
    );
    const response = createMockResponse();
    await interceptConnectRequest(
      {
        method: "POST",
        headers: {},
        socket: { remoteAddress: "127.0.0.1" },
        on(eventName, handler) {
          if (eventName === "end") queueMicrotask(handler);
        },
      },
      response,
      { saveApiKeyIdentity: (identity) => saved.push(identity) },
    );
    return { response, saved };
  } finally {
    globalThis.fetch = previousFetch;
  }
}

test("connect interceptor does not record identity for non-2xx upstream responses", async () => {
  const { response, saved } = await interceptWithUpstream({
    status: 400,
    body: { ok: false, apiKey: "key-1", userId: "user-1", error: "rejected" },
  });

  assert.equal(response.statusCode, 400);
  assert.deepEqual(saved, []);
  assert.deepEqual(JSON.parse(response.body), {
    ok: false,
    apiKey: "key-1",
    userId: "user-1",
    error: "rejected",
  });
});

test("connect interceptor records only apiKey and userId from a successful connect", async () => {
  const { response, saved } = await interceptWithUpstream({
    status: 200,
    body: { ok: true, apiKey: "key-1", userId: "user-1", role: "user", permissions: {} },
  });

  assert.equal(response.statusCode, 200);
  assert.deepEqual(saved, [{ apiKey: "key-1", userId: "user-1" }]);
  assert.deepEqual(JSON.parse(response.body).agentProxy, { enabled: true, wsPath: "/chat/ws" });
});
