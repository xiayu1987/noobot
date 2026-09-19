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
import { createRequire } from "node:module";
import {
  executeSqliteCommand,
  releaseSqliteConnection,
} from "../src/database/index.js";

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

  assert.equal(result.ok, true, result.stderr);
  assert.deepEqual(JSON.parse(result.stdout), [{ value: 42 }]);
});
