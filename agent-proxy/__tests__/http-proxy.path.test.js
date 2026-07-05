import test from "node:test";
import assert from "node:assert/strict";
import { PassThrough, Writable } from "node:stream";
import http from "node:http";
import { existsSync } from "node:fs";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

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

async function waitForFile(filePath, timeoutMs = 5000) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    if (existsSync(filePath)) return;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error(`Timed out waiting for ${filePath}`);
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

test("proxyHttpRequest writes sanitized system event for invalid request URL", async () => {
  const workspaceRoot = await mkdtemp(path.join(tmpdir(), "agent-proxy-http-system-events-"));
  const previousWorkspaceRoot = process.env.NOOBOT_WORKSPACE_ROOT;
  const previousDefaultWorkspaceRoot = process.env.NOOBOT_RUNTIME_EVENTS_WORKSPACE_ROOT;
  delete process.env.NOOBOT_WORKSPACE_ROOT;
  process.env.NOOBOT_RUNTIME_EVENTS_WORKSPACE_ROOT = workspaceRoot;

  try {
    const request = createMockRequest({
      method: "GET",
      url: "http://[?apikey=secret-token&authorization=Bearer%20secret&cookie=session&body=secret-body",
      headers: {},
      body: "secret-body",
    });
    const response = createMockResponse();

    proxyHttpRequest(request, response);

    assert.equal(response.statusCode, 400);
    assert.deepEqual(JSON.parse(response.body()), {
      ok: false,
      error: "agentProxy invalid request url",
    });

    const eventFile = path.join(
      workspaceRoot,
      "system",
      "runtime",
      "events",
      "system",
      "agent-proxy",
      "transport.jsonl",
    );
    await waitForFile(eventFile);
    const raw = await readFile(eventFile, "utf8");
    const records = raw.trim().split("\n").filter(Boolean).map((line) => JSON.parse(line));
    const record = records.find((item) => item.event === "agentProxy.http.invalidRequestUrl");

    assert.ok(record);
    assert.equal(record.scope, "system");
    assert.equal(record.source, "agent-proxy");
    assert.equal(record.category, "transport");
    assert.equal(record.level, "warn");
    assert.equal(record.channel, "direct");
    assert.equal(record.sessionId, undefined);
    assert.equal(record.workspaceRoot, undefined);
    assert.equal(record.data.method, "GET");
    assert.equal(record.data.requestUrlLength, request.url.length);
    assert.ok(record.error?.message);
    const serialized = JSON.stringify(record);
    assert.equal(serialized.includes("secret-token"), false);
    assert.equal(serialized.includes("authorization"), false);
    assert.equal(serialized.includes("cookie"), false);
    assert.equal(serialized.includes("apikey"), false);
    assert.equal(serialized.includes("secret-body"), false);
  } finally {
    if (previousWorkspaceRoot === undefined) delete process.env.NOOBOT_WORKSPACE_ROOT;
    else process.env.NOOBOT_WORKSPACE_ROOT = previousWorkspaceRoot;
    if (previousDefaultWorkspaceRoot === undefined) delete process.env.NOOBOT_RUNTIME_EVENTS_WORKSPACE_ROOT;
    else process.env.NOOBOT_RUNTIME_EVENTS_WORKSPACE_ROOT = previousDefaultWorkspaceRoot;
    await rm(workspaceRoot, { recursive: true, force: true });
  }
});

test("proxyHttpRequest writes sanitized system event for upstream request failure", async () => {
  const workspaceRoot = await mkdtemp(path.join(tmpdir(), "agent-proxy-http-upstream-events-"));
  const previousWorkspaceRoot = process.env.NOOBOT_WORKSPACE_ROOT;
  const previousDefaultWorkspaceRoot = process.env.NOOBOT_RUNTIME_EVENTS_WORKSPACE_ROOT;
  const previousBase = config.upstreamHttpBase;
  delete process.env.NOOBOT_WORKSPACE_ROOT;
  process.env.NOOBOT_RUNTIME_EVENTS_WORKSPACE_ROOT = workspaceRoot;

  const server = http.createServer((_request, response) => response.end("unused"));
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address();
  await new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
  config.upstreamHttpBase = `http://127.0.0.1:${port}`;

  try {
    const request = createMockRequest({
      method: "POST",
      url: "/api/internal/proxy-fail?apikey=secret-token&authorization=Bearer%20secret",
      headers: { authorization: "Bearer secret-token", cookie: "secret-cookie" },
      body: "secret-body",
    });
    const response = createMockResponse();

    proxyHttpRequest(request, response);
    await new Promise((resolve) => response.on("finish", resolve));

    assert.equal(response.statusCode, 502);
    assert.deepEqual(JSON.parse(response.body()), {
      ok: false,
      error: "Bad Gateway",
    });

    const eventFile = path.join(
      workspaceRoot,
      "system",
      "runtime",
      "events",
      "system",
      "agent-proxy",
      "transport.jsonl",
    );
    await waitForFile(eventFile);
    const raw = await readFile(eventFile, "utf8");
    const records = raw.trim().split("\n").filter(Boolean).map((line) => JSON.parse(line));
    const record = records.find((item) => item.event === "agentProxy.http.upstreamRequest.failed");

    assert.ok(record);
    assert.equal(record.scope, "system");
    assert.equal(record.source, "agent-proxy");
    assert.equal(record.category, "transport");
    assert.equal(record.level, "error");
    assert.equal(record.channel, "direct");
    assert.equal(record.sessionId, undefined);
    assert.equal(record.workspaceRoot, undefined);
    assert.equal(record.data.method, "POST");
    assert.equal(record.data.pathname, "/internal/proxy-fail");
    assert.equal(record.data.statusCode, 502);
    assert.equal(record.data.timedOut, false);
    assert.ok(record.error?.message);
    const serialized = JSON.stringify(record);
    assert.equal(serialized.includes("secret-token"), false);
    assert.equal(serialized.includes("authorization"), false);
    assert.equal(serialized.includes("cookie"), false);
    assert.equal(serialized.includes("apikey"), false);
    assert.equal(serialized.includes("secret-body"), false);
  } finally {
    config.upstreamHttpBase = previousBase;
    if (previousWorkspaceRoot === undefined) delete process.env.NOOBOT_WORKSPACE_ROOT;
    else process.env.NOOBOT_WORKSPACE_ROOT = previousWorkspaceRoot;
    if (previousDefaultWorkspaceRoot === undefined) delete process.env.NOOBOT_RUNTIME_EVENTS_WORKSPACE_ROOT;
    else process.env.NOOBOT_RUNTIME_EVENTS_WORKSPACE_ROOT = previousDefaultWorkspaceRoot;
    await rm(workspaceRoot, { recursive: true, force: true });
  }
});
