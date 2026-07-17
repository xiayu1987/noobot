/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { startHttpServer } from "../bootstrap/start-http-server.js";

async function waitForFile(filePath, { timeoutMs = 1000 } = {}) {
  const deadline = Date.now() + timeoutMs;
  let lastError;
  while (Date.now() < deadline) {
    try {
      await fs.access(filePath);
      return;
    } catch (error) {
      lastError = error;
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
  }
  throw lastError;
}

async function readJsonl(filePath) {
  const content = await fs.readFile(filePath, "utf8");
  return content.trim().split("\n").filter(Boolean).map((line) => JSON.parse(line));
}

async function closeServer(server) {
  await new Promise((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
}

test("startHttpServer writes a startup runtime event when listen succeeds", async () => {
  const workspaceRoot = await fs.mkdtemp(path.join(os.tmpdir(), "noobot-service-startup-"));
  const server = startHttpServer({
    app: (_req, res) => {
      res.statusCode = 404;
      res.end("not-found");
    },
    getBot: () => ({ runSession: async () => ({}) }),
    resolveRequestLocale: () => "zh-CN",
    resolveAuthByApiKey: () => ({ userId: "primary-user" }),
    isForbiddenUserScope: () => false,
    normalizeRunConfig: (config = {}) => config || {},
    normalizeLocale: (locale = "") => String(locale || "zh-CN"),
    defaultLocale: "zh-CN",
    translateText: (key = "") => String(key || ""),
    workspaceRootPath: () => workspaceRoot,
    port: 0,
  });

  try {
    const eventFile = path.join(
      workspaceRoot,
      "system",
      "runtime",
      "events",
      "startup",
      "service",
      "state.jsonl",
    );
    await waitForFile(eventFile);
    const records = await readJsonl(eventFile);
    const record = records.find((item) => item.event === "service.startup.httpServer.listen.started");

    assert.ok(record);
    assert.equal(record.scope, "startup");
    assert.equal(record.source, "service");
    assert.equal(record.category, "state");
    assert.equal(record.level, "info");
    assert.equal(record.channel, "direct");
    assert.equal(record.workspaceRoot, workspaceRoot);
    assert.equal(record.sessionId, undefined);
    assert.equal(record.data.host, "::");
    assert.equal(typeof record.data.port, "number");
    assert.ok(record.data.port > 0);
    assert.equal(typeof record.process.pid, "number");
    assert.equal(record.process.nodeVersion, process.version);
  } finally {
    await closeServer(server);
    await fs.rm(workspaceRoot, { recursive: true, force: true });
  }
});
