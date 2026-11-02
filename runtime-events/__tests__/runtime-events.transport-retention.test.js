/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { appendJsonLine } from "../src/transports/jsonl.js";
import { writeRuntimeEvent } from "../src/index.js";
import { pathExists, readJsonl, tempRoot, writeArchive } from "./runtime-events-test-fixtures.js";

const disabled = { maxFileBytes: 0, retentionDays: 0, maxArchives: 0 };

test("JSONL rotates at the configured capacity and preserves both records", async () => {
  const file = path.join(await tempRoot(), "system.jsonl");
  const first = await appendJsonLine(file, { id: 1 }, { ...disabled, maxFileBytes: 1 });
  const second = await appendJsonLine(file, { id: 2 }, { ...disabled, maxFileBytes: 1 });
  assert.equal(first.rotatedFile, null);
  assert.match(second.rotatedFile, /system\.\d{8}T\d{6}Z\.jsonl$/);
  assert.deepEqual(await readJsonl(second.rotatedFile), [{ id: 1 }]);
  assert.deepEqual(await readJsonl(file), [{ id: 2 }]);
});

test("JSONL zero capacity disables rotation and concurrent writes preserve all records", async () => {
  const file = path.join(await tempRoot(), "system.jsonl");
  const results = await Promise.all(
    Array.from({ length: 100 }, (_, id) => appendJsonLine(file, { id }, disabled)),
  );
  assert.ok(results.every((result) => result.ok && !result.rotatedFile));
  assert.equal(new Set((await readJsonl(file)).map(({ id }) => id)).size, 100);
});

test("JSONL retention removes expired archives and preserves fresh and unrelated files", async () => {
  const root = await tempRoot();
  const file = path.join(root, "system.jsonl");
  await fs.mkdir(root, { recursive: true });
  const old = await writeArchive(path.join(root, "system.20000101T000000Z.jsonl"), 2 * 86400000);
  const fresh = await writeArchive(path.join(root, "system.29990101T000000Z.jsonl"));
  const unrelated = await writeArchive(
    path.join(root, "interaction.20000101T000000Z.jsonl"),
    2 * 86400000,
  );
  const result = await appendJsonLine(file, { id: 1 }, { ...disabled, retentionDays: 1 });
  assert.deepEqual(result.deletedFiles, [old]);
  assert.equal(await pathExists(fresh), true);
  assert.equal(await pathExists(unrelated), true);
  assert.equal(await pathExists(file), true);
});

test("JSONL archive count keeps only the newest archives", async () => {
  const root = await tempRoot();
  const file = path.join(root, "system.jsonl");
  const old = await writeArchive(path.join(root, "system.20000101T000000Z.jsonl"), 3000);
  const second = await writeArchive(path.join(root, "system.20000101T000001Z.jsonl"), 2000);
  const third = await writeArchive(path.join(root, "system.20000101T000002Z.jsonl"), 1000);
  const result = await appendJsonLine(file, { id: 1 }, { ...disabled, maxArchives: 2 });
  assert.deepEqual(result.deletedFiles, [old]);
  assert.equal(await pathExists(second), true);
  assert.equal(await pathExists(third), true);
});

test("JSONL zero retention and count disable cleanup", async () => {
  const root = await tempRoot();
  const archive = await writeArchive(
    path.join(root, "system.20000101T000000Z.jsonl"),
    30 * 86400000,
  );
  const result = await appendJsonLine(path.join(root, "system.jsonl"), { id: 1 }, disabled);
  assert.deepEqual(result.deletedFiles, []);
  assert.equal(await pathExists(archive), true);
});

test("JSONL cleanup failure reports once per batch and preserves the write", async (t) => {
  const root = await tempRoot();
  const file = path.join(root, "system.jsonl");
  const archive = await writeArchive(
    path.join(root, "system.20000101T000000Z.jsonl"),
    2 * 86400000,
  );
  const warn = t.mock.method(console, "warn", () => {});
  t.mock.method(fs, "unlink", async () => {
    throw Object.assign(new Error("simulated unlink failure"), { code: "EPERM" });
  });
  const results = await Promise.all(
    [1, 2].map((id) => appendJsonLine(file, { id }, { ...disabled, retentionDays: 1 })),
  );
  assert.ok(results.every((result) => result.ok && result.cleanupError));
  assert.equal(warn.mock.callCount(), 1);
  assert.equal(await pathExists(archive), true);
  assert.equal((await readJsonl(file)).length, 2);
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
