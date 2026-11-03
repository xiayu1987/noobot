/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { promisify } from "node:util";
import { mcpTestServers } from "../mcp-test-service/config.mjs";

const execFileAsync = promisify(execFile);

test("Docker workspace refresh isolates MCP configuration and preserves runtime evidence", async (t) => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "noobot-e2e-workspace-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const source = path.join(directory, "source");
  const target = path.join(directory, "target");
  const globalPath = path.join(directory, "global.config.json");
  await mkdir(path.join(source, "admin"), { recursive: true });
  await mkdir(path.join(target, "admin", "runtime"), { recursive: true });
  const sourceConfig = JSON.stringify({
    mcp_servers: { remote: { baseUrl: "https://example.com" } },
  });
  await writeFile(globalPath, JSON.stringify({ super_admin: { user_id: "admin" } }));
  await writeFile(path.join(source, "user.json"), JSON.stringify({ users: [{ userId: "admin" }] }));
  await writeFile(path.join(source, "admin", "config.json"), sourceConfig);
  const evidencePath = path.join(target, "admin", "runtime", "evidence.json");
  await writeFile(evidencePath, "preserve-session-and-audit");
  const prepareScript = path.join(import.meta.dirname, "prepare-workspace.mjs");
  for (let pass = 0; pass < 2; pass += 1) {
    await execFileAsync(process.execPath, [prepareScript, source, target, globalPath]);
    for (const file of ["global.config.json", "admin/config.json"]) {
      const config = JSON.parse(await readFile(path.join(target, file), "utf8"));
      assert.deepEqual(config.mcp_servers, mcpTestServers());
    }
    assert.equal(await readFile(evidencePath, "utf8"), "preserve-session-and-audit");
    assert.equal(await readFile(path.join(source, "admin", "config.json"), "utf8"), sourceConfig);
  }
});

test("Docker workspace refresh rejects a user without source config.json", async (t) => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "noobot-e2e-workspace-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const source = path.join(directory, "source");
  const target = path.join(directory, "target");
  const globalPath = path.join(directory, "global.config.json");
  await mkdir(path.join(source, "admin"), { recursive: true });
  await writeFile(globalPath, JSON.stringify({ super_admin: { user_id: "admin" } }));
  await writeFile(path.join(source, "user.json"), JSON.stringify({ users: [{ userId: "admin" }] }));
  const prepareScript = path.join(import.meta.dirname, "prepare-workspace.mjs");
  await assert.rejects(
    execFileAsync(process.execPath, [prepareScript, source, target, globalPath]),
    (error) => {
      assert.match(error.stderr, /e2e workspace user admin requires admin\/config\.json in source/);
      return true;
    },
  );
});
