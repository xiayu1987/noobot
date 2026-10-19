/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import test from "node:test";

import { RUNTIME_EVENTS_CONFIG_ENVS } from "@noobot/shared/runtime-events-config";
import { writeRuntimeEvent } from "../src/index.js";

import {
  pathExists,
  persistSession,
  readJsonl,
  tempRoot,
  writeArchive,
  useRuntimeEventsEnv,
} from "./runtime-events-test-fixtures.js";
import { SESSION_CALLER } from "@noobot/shared/session-caller";

test("runtime event jsonl transport rotates active file when max file bytes is exceeded", async () => {
  const workspaceRoot = await tempRoot();
  await persistSession(workspaceRoot, "admin", {
    sessionId: "rotation-2",
    parentSessionId: "",
    caller: SESSION_CALLER.USER,
  });
  const baseEvent = {
    source: "agent",
    scope: "session",
    category: "system",
    level: "info",
    userId: "admin",
    sessionId: "rotation-2",
  };
  useRuntimeEventsEnv({ storage: { maxFileBytes: 1 } });
  const first = await writeRuntimeEvent({
    ...baseEvent,
    event: "agent.runtime.rotation.archiveSource",
    data: { message: "x".repeat(160) },
  });
  useRuntimeEventsEnv({ storage: { maxFileBytes: 1 } });
  const second = await writeRuntimeEvent({
    ...baseEvent,
    event: "agent.runtime.rotation.activeAfterArchive",
    data: { message: "y".repeat(160) },
  });

  assert.equal(first.ok, true);
  assert.equal(first.rotatedFile, null);
  assert.equal(second.ok, true);
  assert.match(second.rotatedFile, /system\.\d{8}T\d{6}Z\.jsonl$/);
  const archivedRecords = await readJsonl(second.rotatedFile);
  const activeRecords = await readJsonl(second.file);
  assert.equal(archivedRecords.length, 1);
  assert.equal(archivedRecords[0].event, "agent.runtime.rotation.archiveSource");
  assert.equal(activeRecords.length, 1);
  assert.equal(activeRecords[0].event, "agent.runtime.rotation.activeAfterArchive");
});

test("runtime event max file bytes can be disabled with zero", async () => {
  const workspaceRoot = await tempRoot();
  await persistSession(workspaceRoot, "admin", {
    sessionId: "rotation-disabled",
    parentSessionId: "",
    caller: SESSION_CALLER.USER,
  });
  const baseEvent = {
    source: "agent",
    scope: "session",
    category: "system",
    level: "info",
    userId: "admin",
    sessionId: "rotation-disabled",
  };
  useRuntimeEventsEnv({ storage: { maxFileBytes: 0 } });
  const first = await writeRuntimeEvent({
    ...baseEvent,
    event: "agent.runtime.rotation.disabledFirst",
    data: { message: "x".repeat(160) },
  });
  useRuntimeEventsEnv({ storage: { maxFileBytes: 0 } });
  const second = await writeRuntimeEvent({
    ...baseEvent,
    event: "agent.runtime.rotation.disabledSecond",
    data: { message: "y".repeat(160) },
  });

  assert.equal(first.ok, true);
  assert.equal(second.ok, true);
  assert.equal(second.rotatedFile, null);
  assert.equal((await readJsonl(second.file)).length, 2);
});

test("runtime event jsonl transport serializes concurrent writes to the same file", async () => {
  const workspaceRoot = await tempRoot();
  await persistSession(workspaceRoot, "admin", {
    sessionId: "concurrent-writes",
    parentSessionId: "",
    caller: SESSION_CALLER.USER,
  });
  const writes = await Promise.all(
    Array.from({ length: 100 }, (_, id) =>
      writeRuntimeEvent({
        source: "agent",
        scope: "session",
        category: "system",
        level: "info",
        event: "agent.runtime.concurrentWrite",
        userId: "admin",
        sessionId: "concurrent-writes",
        data: { id },
      }),
    ),
  );
  assert.equal(
    writes.every((result) => result.ok),
    true,
  );
  const records = await readJsonl(writes[0].file);
  assert.equal(records.length, 100);
  assert.deepEqual(new Set(records.map((record) => record.data.id)).size, 100);
});

test("runtime event max file bytes falls back when environment value is invalid", async () => {
  const maxFileBytesEnv = RUNTIME_EVENTS_CONFIG_ENVS.runtimeEvents.maxFileBytes;
  const previousMaxFileBytes = process.env[maxFileBytesEnv];
  const previousDefaultWorkspaceRoot = process.env.NOOBOT_WORKSPACE_ROOT;
  const defaultWorkspaceRoot = await tempRoot();
  try {
    await persistSession(defaultWorkspaceRoot, "admin", {
      sessionId: "rotation-invalid-env",
      parentSessionId: "",
      caller: SESSION_CALLER.USER,
    });
    process.env[maxFileBytesEnv] = "invalid";
    process.env.NOOBOT_WORKSPACE_ROOT = defaultWorkspaceRoot;
    const first = await writeRuntimeEvent({
      scope: "session",
      source: "agent",
      category: "system",
      level: "info",
      event: "agent.runtime.rotation.invalidEnvFirst",
      userId: "admin",
      sessionId: "rotation-invalid-env",
      data: { message: "x".repeat(160) },
    });
    const second = await writeRuntimeEvent({
      scope: "session",
      source: "agent",
      category: "system",
      level: "info",
      event: "agent.runtime.rotation.invalidEnvSecond",
      userId: "admin",
      sessionId: "rotation-invalid-env",
      data: { message: "y".repeat(160) },
    });

    assert.equal(first.ok, true);
    assert.equal(second.ok, true);
    assert.equal(second.rotatedFile, null);
    assert.equal((await readJsonl(second.file)).length, 2);
  } finally {
    if (previousMaxFileBytes === undefined) delete process.env[maxFileBytesEnv];
    else process.env[maxFileBytesEnv] = previousMaxFileBytes;
    if (previousDefaultWorkspaceRoot === undefined) delete process.env.NOOBOT_WORKSPACE_ROOT;
    else process.env.NOOBOT_WORKSPACE_ROOT = previousDefaultWorkspaceRoot;
  }
});

test("runtime event archive cleanup deletes archives older than retention days", async () => {
  const workspaceRoot = await tempRoot();
  await persistSession(workspaceRoot, "admin", {
    sessionId: "cleanup-ttl",
    parentSessionId: "",
    caller: SESSION_CALLER.USER,
  });
  const baseEvent = {
    source: "agent",
    scope: "session",
    category: "system",
    level: "info",
    userId: "admin",
    sessionId: "cleanup-ttl",
  };
  useRuntimeEventsEnv({ storage: { maxFileBytes: 0, retentionDays: 0, maxArchives: 0 } });
  const seed = await writeRuntimeEvent({ ...baseEvent, event: "agent.runtime.cleanup.seed" });
  const oldArchive = path.join(path.dirname(seed.file), "system.20000101T000000Z.jsonl");
  const freshArchive = path.join(path.dirname(seed.file), "system.29990101T000000Z.jsonl");
  await writeArchive(oldArchive, 2 * 24 * 60 * 60 * 1000);
  await writeArchive(freshArchive, 0);

  useRuntimeEventsEnv({ storage: { maxFileBytes: 0, retentionDays: 1, maxArchives: 0 } });
  const result = await writeRuntimeEvent({ ...baseEvent, event: "agent.runtime.cleanup.ttl" });

  assert.equal(result.ok, true);
  assert.equal(await pathExists(oldArchive), false);
  assert.equal(await pathExists(freshArchive), true);
  assert.equal(await pathExists(result.file), true);
  assert.deepEqual(result.deletedFiles, [oldArchive]);
});

test("runtime event archive cleanup keeps only newest max archives", async () => {
  const workspaceRoot = await tempRoot();
  await persistSession(workspaceRoot, "admin", {
    sessionId: "cleanup-max",
    parentSessionId: "",
    caller: SESSION_CALLER.USER,
  });
  const baseEvent = {
    source: "agent",
    scope: "session",
    category: "system",
    level: "info",
    userId: "admin",
    sessionId: "cleanup-max",
  };
  useRuntimeEventsEnv({ storage: { maxFileBytes: 0, retentionDays: 0, maxArchives: 0 } });
  const seed = await writeRuntimeEvent({ ...baseEvent, event: "agent.runtime.cleanup.maxSeed" });
  const dir = path.dirname(seed.file);
  const first = await writeArchive(path.join(dir, "system.20000101T000000Z.jsonl"), 3000);
  const second = await writeArchive(path.join(dir, "system.20000101T000001Z.jsonl"), 2000);
  const third = await writeArchive(path.join(dir, "system.20000101T000002Z.jsonl"), 1000);

  useRuntimeEventsEnv({ storage: { maxFileBytes: 0, retentionDays: 0, maxArchives: 2 } });
  const result = await writeRuntimeEvent({ ...baseEvent, event: "agent.runtime.cleanup.max" });

  assert.equal(result.ok, true);
  assert.equal(await pathExists(first), false);
  assert.equal(await pathExists(second), true);
  assert.equal(await pathExists(third), true);
  assert.equal(await pathExists(result.file), true);
  assert.deepEqual(result.deletedFiles, [first]);
});

test("runtime event archive cleanup can be disabled", async () => {
  const workspaceRoot = await tempRoot();
  await persistSession(workspaceRoot, "admin", {
    sessionId: "cleanup-disabled",
    parentSessionId: "",
    caller: SESSION_CALLER.USER,
  });
  const baseEvent = {
    source: "agent",
    scope: "session",
    category: "system",
    level: "info",
    userId: "admin",
    sessionId: "cleanup-disabled",
  };
  useRuntimeEventsEnv({ storage: { maxFileBytes: 0, retentionDays: 0, maxArchives: 0 } });
  const seed = await writeRuntimeEvent({
    ...baseEvent,
    event: "agent.runtime.cleanup.disabledSeed",
  });
  const archive = await writeArchive(
    path.join(path.dirname(seed.file), "system.20000101T000000Z.jsonl"),
    30 * 24 * 60 * 60 * 1000,
  );

  useRuntimeEventsEnv({ storage: { maxFileBytes: 0, retentionDays: 0, maxArchives: 0 } });
  const result = await writeRuntimeEvent({ ...baseEvent, event: "agent.runtime.cleanup.disabled" });

  assert.equal(result.ok, true);
  assert.equal(await pathExists(archive), true);
  assert.deepEqual(result.deletedFiles, []);
});

test("runtime event archive cleanup ignores active and unrelated jsonl files", async () => {
  const workspaceRoot = await tempRoot();
  await persistSession(workspaceRoot, "admin", {
    sessionId: "cleanup-active",
    parentSessionId: "",
    caller: SESSION_CALLER.USER,
  });
  const baseEvent = {
    source: "agent",
    scope: "session",
    category: "system",
    level: "info",
    userId: "admin",
    sessionId: "cleanup-active",
  };
  useRuntimeEventsEnv({ storage: { maxFileBytes: 0, retentionDays: 0, maxArchives: 0 } });
  const seed = await writeRuntimeEvent({ ...baseEvent, event: "agent.runtime.cleanup.activeSeed" });
  const unrelated = await writeArchive(
    path.join(path.dirname(seed.file), "interaction.20000101T000000Z.jsonl"),
    30 * 24 * 60 * 60 * 1000,
  );

  useRuntimeEventsEnv({ storage: { maxFileBytes: 0, retentionDays: 1, maxArchives: 0 } });
  const result = await writeRuntimeEvent({ ...baseEvent, event: "agent.runtime.cleanup.active" });

  assert.equal(result.ok, true);
  assert.equal(await pathExists(result.file), true);
  assert.equal(await pathExists(unrelated), true);
  assert.equal((await readJsonl(result.file)).length, 2);
});

test("runtime event archive cleanup failure is reported once per batch and keeps the write", async (t) => {
  const workspaceRoot = await tempRoot();
  await persistSession(workspaceRoot, "admin", {
    sessionId: "cleanup-fail",
    parentSessionId: "",
    caller: SESSION_CALLER.USER,
  });
  const baseEvent = {
    source: "agent",
    scope: "session",
    category: "system",
    level: "info",
    userId: "admin",
    sessionId: "cleanup-fail",
  };
  useRuntimeEventsEnv({ storage: { maxFileBytes: 0, retentionDays: 0, maxArchives: 0 } });
  const seed = await writeRuntimeEvent({ ...baseEvent, event: "agent.runtime.cleanupFail.seed" });
  const oldArchive = path.join(path.dirname(seed.file), "system.20000101T000000Z.jsonl");
  await writeArchive(oldArchive, 2 * 24 * 60 * 60 * 1000);

  const warn = t.mock.method(console, "warn", () => {});
  t.mock.method(fs, "unlink", async () => {
    throw Object.assign(new Error("simulated unlink failure"), { code: "EPERM" });
  });
  useRuntimeEventsEnv({ storage: { maxFileBytes: 0, retentionDays: 1, maxArchives: 0 } });
  const results = await Promise.all([
    writeRuntimeEvent({ ...baseEvent, event: "agent.runtime.cleanupFail.a" }),
    writeRuntimeEvent({ ...baseEvent, event: "agent.runtime.cleanupFail.b" }),
  ]);

  for (const result of results) {
    assert.equal(result.ok, true);
    assert.equal(result.cleanupError, true);
  }
  const reports = warn.mock.calls.filter((call) =>
    String(call.arguments[0]).includes("archive cleanup failed"),
  );
  assert.equal(reports.length, 1);
  assert.equal(reports[0].arguments[2].code, "EPERM");
  assert.equal(await pathExists(oldArchive), true);
  assert.equal((await readJsonl(results[0].file)).length, 3);
});

test("runtime event transport failure is reported once and returned as ok:false", async (t) => {
  const workspaceRoot = await tempRoot();

  const blockedSourceDir = path.join(
    workspaceRoot,
    "system",
    "runtime",
    "events",
    "system",
    "agent",
  );
  await fs.mkdir(path.dirname(blockedSourceDir), { recursive: true });
  await fs.writeFile(blockedSourceDir, "not a directory", "utf8");
  const warn = t.mock.method(console, "warn", () => {});
  const result = await writeRuntimeEvent({
    scope: "system",
    source: "agent",
    category: "system",
    level: "info",
    event: "agent.runtime.writeFail.transport",
  });

  assert.equal(result.ok, false);
  assert.ok(result.error instanceof Error);
  assert.equal(result.record.event, "agent.runtime.writeFail.transport");
  assert.equal(path.dirname(result.file), blockedSourceDir);
  const reports = warn.mock.calls.filter((call) =>
    String(call.arguments[0]).includes("write failed"),
  );
  assert.equal(reports.length, 1);
  assert.equal(reports[0].arguments[2], result.error);
});

test("runtime event protocol errors reject instead of being reported as transport failures", async (t) => {
  await tempRoot();
  const warn = t.mock.method(console, "warn", () => {});
  await assert.rejects(
    writeRuntimeEvent({
      source: "agent",
      category: "system",
      level: "info",
      event: "agent.runtime.writeFail.missingScope",
    }),
    /Invalid runtime event scope: undefined/,
  );
  assert.equal(warn.mock.callCount(), 0);
});
