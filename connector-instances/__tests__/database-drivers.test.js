/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { CONNECTOR_FAILURE_CODE } from "@noobot/connector-protocol";
import { createRequire } from "node:module";
import { executeSqliteCommand, releaseSqliteConnection } from "../src/database/index.js";

const require = createRequire(import.meta.url);

test("better-sqlite3 ships the Windows x64 native binding used by desktop packaging", async () => {
  const packageFile = require.resolve("better-sqlite3/package.json");
  const binding = path.join(path.dirname(packageFile), "prebuilds", "win32-x64.node");
  assert.equal((await fs.stat(binding)).isFile(), true);
});

test("SQLite driver executes a query through its bundled native binding", async (context) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "noobot-sqlite-driver-"));
  const databaseFile = path.join(directory, "driver-smoke.db");
  context.after(async () => {
    releaseSqliteConnection(databaseFile);
    await fs.rm(directory, { recursive: true, force: true });
  });

  const result = await executeSqliteCommand({
    command: "SELECT 42 AS value WHERE 1=1",
    connectionInfo: { file_path: databaseFile },
    channelKey: databaseFile,
  });

  assert.equal(result.ok, true, result.error);
  assert.deepEqual(JSON.parse(result.output.stdout), [{ value: 42 }]);
});

test("SQLite driver opens the configured file_path, not the channel key", async (context) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "noobot-sqlite-path-"));
  const databaseFile = path.join(directory, "configured.db");
  const channelKey = "owner::connector-id";
  context.after(async () => {
    releaseSqliteConnection(channelKey);
    await fs.rm(directory, { recursive: true, force: true });
  });

  const result = await executeSqliteCommand({
    command: "CREATE TABLE marker (id INTEGER)",
    connectionInfo: { file_path: databaseFile },
    channelKey,
  });

  assert.equal(result.ok, true, result.error);
  assert.equal((await fs.stat(databaseFile)).isFile(), true);
  await assert.rejects(fs.stat(path.resolve(channelKey)), { code: "ENOENT" });
});

test("SQLite driver reports named failures for invalid input and config", async () => {
  assert.deepEqual(
    await executeSqliteCommand({ command: "", connectionInfo: {}, channelKey: "k" }),
    { ok: false, code: CONNECTOR_FAILURE_CODE.INPUT_INVALID, error: "sqlite command required" },
  );
  assert.deepEqual(
    await executeSqliteCommand({ command: "SELECT 1", connectionInfo: {}, channelKey: "k" }),
    {
      ok: false,
      code: CONNECTOR_FAILURE_CODE.CONFIG_INVALID,
      error: "sqlite file_path is required",
    },
  );
});
