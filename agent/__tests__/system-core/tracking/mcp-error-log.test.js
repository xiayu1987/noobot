/*
 * Copyright (c) 2026 xiayu
 * SPDX-License-Identifier: MIT
 */
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { appendMcpErrorLog } from "../../../src/system-core/tracking/error-log/mcp-error-log.js";

async function makeTempDir() {
  return fs.mkdtemp(path.join(os.tmpdir(), "noobot-mcp-error-log-"));
}

async function readJsonLines(filePath) {
  const content = await fs.readFile(filePath, "utf8");
  return content.trim().split("\n").filter(Boolean).map((line) => JSON.parse(line));
}

test("appendMcpErrorLog writes session MCP errors to telemetry session channel", async () => {
  const workspaceRoot = await makeTempDir();
  const basePath = path.join(workspaceRoot, "u1");
  await fs.mkdir(basePath, { recursive: true });

  const record = await appendMcpErrorLog({
    basePath,
    workspaceRoot,
    userId: "u1",
    sessionId: "s1",
    parentSessionId: "p1",
    mcpName: "demo-mcp",
    task: "query data",
    modelName: "demo-model",
    source: "call_mcp_task",
    event: "call_mcp_task_failed",
    message: "mcp boom",
    stack: "mcp stack",
    details: { code: "E_MCP" },
  });

  assert.equal(record.sessionId, "s1");
  const telemetryFile = path.join(workspaceRoot, "u1", "runtime", "session", "s1", "logs", "system.jsonl");
  const records = await readJsonLines(telemetryFile);
  assert.equal(records.length, 1);
  assert.equal(records[0].source, "call_mcp_task");
  assert.equal(records[0].category, "system");
  assert.equal(records[0].channel, "direct");
  assert.equal(records[0].event, "call_mcp_task_failed");
  assert.equal(records[0].userId, "u1");
  assert.equal(records[0].sessionId, "s1");
  assert.equal(records[0].parentSessionId, "p1");
  assert.equal(records[0].data.mcpName, "demo-mcp");
  assert.equal(records[0].data.task, "query data");
  assert.equal(records[0].data.modelName, "demo-model");
  assert.deepEqual(records[0].data.details, { code: "E_MCP" });

  await assert.rejects(
    fs.access(path.join(basePath, "mcp-error.log")),
    /ENOENT/,
  );
});

test("appendMcpErrorLog keeps non-session MCP errors in local fallback file", async () => {
  const workspaceRoot = await makeTempDir();
  const basePath = path.join(workspaceRoot, "u1");
  await fs.mkdir(basePath, { recursive: true });

  const record = await appendMcpErrorLog({
    basePath,
    workspaceRoot,
    userId: "u1",
    mcpName: "startup-mcp",
    source: "mcp-startup-check",
    event: "mcp_startup_failed",
    message: "startup mcp boom",
    details: { code: "E_STARTUP_MCP" },
  });

  assert.equal(record.sessionId, "");
  const fallbackFile = path.join(basePath, "mcp-error.log");
  const records = await readJsonLines(fallbackFile);
  assert.equal(records.length, 1);
  assert.equal(records[0].event, "mcp_startup_failed");
  assert.equal(records[0].message, "startup mcp boom");
  assert.equal(records[0].mcpName, "startup-mcp");

  await assert.rejects(
    fs.access(path.join(workspaceRoot, "u1", "runtime", "session", "unknown-session", "logs", "system.jsonl")),
    /ENOENT/,
  );
});
