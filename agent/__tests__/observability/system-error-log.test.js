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
import { appendSystemErrorLog } from "../../src/observability/error-log/system-error-log.js";
import { SystemErrorLogger } from "../../src/observability/error-log/system-error-logger.js";
import { buildEngineErrorPayload } from "../../src/runtime/errors/error-handler.js";
import { persistChildSessionFixture, useRuntimeEventsEnv } from "../helpers/runtime-events-env.js";

test("system logger and engine payload share upstream details and message", async (t) => {
  const workspaceRoot = await makeTempDir();
  t.after(() => fs.rm(workspaceRoot, { recursive: true, force: true }));
  const logger = new SystemErrorLogger({ globalConfig: { workspaceRoot } });
  const errors = [
    {
      cause: {
        error: { status: "429", code: "RATE", type: "provider_error", message: "rate limit" },
        response: { headers: new Headers({ "x-request-id": "req-1" }) },
      },
    },
    { status: -1, message: "invalid status" },
    false,
  ];
  for (const error of errors) await logger.log({ error });
  const records = await readJsonLines(path.join(workspaceRoot, "system-error.log"));
  assert.equal(records.length, errors.length);
  for (const [index, record] of records.entries()) {
    const payload = buildEngineErrorPayload({ error: errors[index] });
    assert.equal(record.message, payload.message);
    for (const field of ["status", "code", "type", "requestId"]) {
      assert.equal(record.extra[field], payload.error[field]);
    }
  }
});

async function makeTempDir() {
  return fs.mkdtemp(path.join(os.tmpdir(), "noobot-system-error-log-"));
}

async function readJsonLines(filePath) {
  const content = await fs.readFile(filePath, "utf8");
  return content
    .trim()
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}

test("appendSystemErrorLog writes session errors to runtime-events session events", async (t) => {
  const workspaceRoot = await makeTempDir();
  useRuntimeEventsEnv(t, { workspaceRoot });
  const eventsDir = await persistChildSessionFixture(workspaceRoot);
  const basePath = path.join(workspaceRoot, "u1");
  await fs.mkdir(basePath, { recursive: true });

  const record = await appendSystemErrorLog({
    basePath,
    workspaceRoot,
    userId: "u1",
    sessionId: "s1",
    parentSessionId: "p1",
    source: "agent-test",
    event: "agent.session.failed",
    message: "boom",
    stack: "stack trace",
    extra: { code: "E_TEST" },
  });

  assert.equal(record.sessionId, "s1");
  const runtimeEventFile = path.join(eventsDir, "system.jsonl");
  const records = await readJsonLines(runtimeEventFile);
  assert.equal(records.length, 1);
  assert.equal(records[0].category, "system");
  assert.equal(records[0].channel, "direct");
  assert.equal(records[0].source, "agent-test");
  assert.equal(records[0].event, "agent.session.failed");
  assert.equal(records[0].sessionId, "s1");
  assert.deepEqual(records[0].data.extra, { code: "E_TEST" });

  await assert.rejects(fs.access(path.join(basePath, "system-error.log")), /ENOENT/);
});

test("appendSystemErrorLog keeps non-session errors in local fallback file", async () => {
  const workspaceRoot = await makeTempDir();
  const basePath = path.join(workspaceRoot, "u1");
  await fs.mkdir(basePath, { recursive: true });

  const record = await appendSystemErrorLog({
    basePath,
    workspaceRoot,
    userId: "u1",
    source: "agent-test",
    event: "agent.startup.failed",
    message: "startup boom",
    extra: { code: "E_STARTUP" },
  });

  assert.equal(record.sessionId, "");
  const fallbackFile = path.join(basePath, "system-error.log");
  const records = await readJsonLines(fallbackFile);
  assert.equal(records.length, 1);
  assert.equal(records[0].event, "agent.startup.failed");
  assert.equal(records[0].message, "startup boom");

  await assert.rejects(
    fs.access(
      path.join(
        workspaceRoot,
        "u1",
        "runtime",
        "session",
        "unknown-session",
        "events",
        "system.jsonl",
      ),
    ),
    /ENOENT/,
  );
});
