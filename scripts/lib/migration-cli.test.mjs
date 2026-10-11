/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import { parseMigrationArgs } from "./migration-cli.mjs";

test("parseMigrationArgs defaults to a dry run over ./workspace", () => {
  assert.deepEqual(parseMigrationArgs(["node", "script"]), {
    workspaceRoot: path.resolve("workspace"),
    write: false,
    backupRoot: "",
  });
});

test("parseMigrationArgs resolves workspace and backup paths for writes", () => {
  assert.deepEqual(
    parseMigrationArgs(["node", "script", "--workspace=/w", "--backup=/b", "--write"]),
    {
      workspaceRoot: path.resolve("/w"),
      write: true,
      backupRoot: path.resolve("/b"),
    },
  );
});

test("parseMigrationArgs refuses writes without a backup directory", () => {
  assert.throws(
    () => parseMigrationArgs(["node", "script", "--write"]),
    /--write requires --backup/,
  );
});
