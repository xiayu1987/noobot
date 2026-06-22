import test from "node:test";
import assert from "node:assert/strict";
import { PassThrough, Writable } from "node:stream";
import http from "node:http";

import { config } from "../src/config.js";
import { normalizeProxyPathname, proxyHttpRequest } from "../src/http-proxy.js";

function createMockRequest({ method = "POST", url = "/", headers = {}, body = "" } = {}) {
  const request = new PassThrough();
  request.method = method;
  request.url = url;
  request.headers = headers;
  process.nextTick(() => {
    request.end(body);
  });
  return request;
}

function createMockResponse() {
  const chunks = [];
  const response = new Writable({
    write(chunk, encoding, callback) {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk), encoding));
      callback();
    },
  });
  response.headersSent = false;
  response.writeHead = (statusCode, headers = {}) => {
    response.statusCode = statusCode;
    response.headers = headers;
    response.headersSent = true;
  };
  response.body = () => Buffer.concat(chunks).toString("utf8");
  return response;
}

async function withUpstreamServer(handler, run) {
  const server = http.createServer(handler);
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address();
  const previousBase = config.upstreamHttpBase;
  config.upstreamHttpBase = `http://127.0.0.1:${port}`;
  try {
    return await run();
  } finally {
    config.upstreamHttpBase = previousBase;
    await new Promise((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
  }
}

test("normalizeProxyPathname strips /api prefix before forwarding to service", () => {
  assert.equal(normalizeProxyPathname("/api/internal/session/u/s/messages/replace-turn"), "/internal/session/u/s/messages/replace-turn");
  assert.equal(normalizeProxyPathname("/api/internal/connect"), "/internal/connect");
  assert.equal(normalizeProxyPathname("/api"), "/");
  assert.equal(normalizeProxyPathname("/internal/session/u/s"), "/internal/session/u/s");
});

test("proxyHttpRequest forwards /api/internal replace-turn to upstream /internal route", async () => {
  const seen = {};
  await withUpstreamServer((request, response) => {
    seen.method = request.method;
    seen.url = request.url;
    const chunks = [];
    request.on("data", (chunk) => chunks.push(chunk));
    request.on("end", () => {
      seen.body = Buffer.concat(chunks).toString("utf8");
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify({ ok: true }));
    });
  }, async () => {
    const request = createMockRequest({
      method: "POST",
      url: "/api/internal/session/admin/93606d58-60eb-4ca4-bccf-c926e67e1fed/messages/replace-turn?trace=1",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ anchor: { turnId: "turn-1" }, newContent: "hello" }),
    });
    const response = createMockResponse();

    proxyHttpRequest(request, response);

    await new Promise((resolve) => response.on("finish", resolve));
  });

  assert.equal(seen.method, "POST");
  assert.equal(
    seen.url,
    "/internal/session/admin/93606d58-60eb-4ca4-bccf-c926e67e1fed/messages/replace-turn?trace=1",
  );
  assert.deepEqual(JSON.parse(seen.body), {
    anchor: { turnId: "turn-1" },
    newContent: "hello",
  });
});
