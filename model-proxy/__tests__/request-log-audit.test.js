/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import assert from "node:assert/strict";
import { once } from "node:events";
import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { setTimeout } from "node:timers/promises";
import test from "node:test";
import { createLogger } from "../src/logger.js";
import { createProxyServer } from "../src/server.js";
import { validateRequestLogOrder } from "../../scripts/quality/model-context-convergence/request-log-audit.mjs";

test(
  "an interrupted upload persists its correlated terminal and passes the production log audit",
  { timeout: 5000 },
  async (t) => {
    const logDir = await mkdtemp(path.join(os.tmpdir(), "noobot-request-audit-"));
    t.after(() => rm(logDir, { recursive: true, force: true }));
    let receivedPartial;
    const partialReceived = new Promise((resolve) => {
      receivedPartial = resolve;
    });
    const upstream = http.createServer((req, res) => {
      req.on("error", () => {});
      req.once("data", () => {
        if (req.headers["content-length"] === "1000") receivedPartial();
      });
      req.on("end", () => res.end("ok"));
    });
    upstream.listen(0, "127.0.0.1");
    await once(upstream, "listening");
    t.after(() => {
      upstream.closeAllConnections();
      upstream.close();
    });
    const logger = createLogger({
      logDir,
      logPrefix: "requests",
      unknownModelName: "unknown-model",
      unknownFlowName: "unknown-flow",
      unknownSessionId: "unknown-session",
      maxLogFileSizeBytes: 1024 * 1024,
      retainMs: 60000,
    });
    const proxy = createProxyServer({
      localPort: 0,
      targetUrl: `http://127.0.0.1:${upstream.address().port}`,
      proxyHost: "127.0.0.1",
      logger,
      measureRequestPrefix: () => null,
      headerExtractors: {
        extractModelNameFromHeaders: () => "test-model",
        extractFlowFromHeaders: () => "test-flow",
        extractSessionIdFromHeaders: () => "test-session",
        extractParentSessionIdFromHeaders: () => "",
      },
    });
    await once(proxy, "listening");
    t.after(() => {
      proxy.closeAllConnections();
      proxy.close();
    });
    const options = {
      host: "127.0.0.1",
      port: proxy.address().port,
      method: "POST",
      path: "/v1/responses",
      headers: { "x-model-operation": "web_search" },
    };
    await new Promise((resolve, reject) => {
      const req = http.request(options, (res) => {
        res.resume();
        res.on("end", resolve);
      });
      req.on("error", reject);
      req.end(JSON.stringify({ input: "complete request" }));
    });
    const partial = http.request({
      ...options,
      headers: { ...options.headers, "content-length": "1000" },
    });
    partial.on("error", (error) => assert.equal(error.code, "ECONNRESET"));
    partial.write('{"input":"unfinished');
    await partialReceived;
    partial.destroy();
    const sessionDir = path.join(logDir, "test-model", "test-flow", "test-session");
    const deadline = Date.now() + 2000;
    let logs;
    let content;
    do {
      logs = (await readdir(sessionDir)).map((name) => path.join(sessionDir, name));
      content = (await Promise.all(logs.map((file) => readFile(file, "utf8")))).join("\n");
      if ((content.match(/^\[Terminal\]$/gm) || []).length === 2) break;
      await setTimeout(10);
    } while (Date.now() < deadline);
    assert.equal((content.match(/^\[Terminal\]$/gm) || []).length, 2);
    assert.match(content, /BodyComplete: false/);
    assert.match(content, /Outcome: client_aborted/);
    const failures = [];
    const passes = [];
    validateRequestLogOrder(logs, {
      fail: (title, detail) => failures.push({ title, detail }),
      pass: (title) => passes.push(title),
    });
    assert.deepEqual(failures, []);
    assert.match(passes[0], /incomplete transport bodies=1/);
  },
);
