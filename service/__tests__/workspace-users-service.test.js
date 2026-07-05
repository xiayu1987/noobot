import test from "node:test";
import assert from "node:assert/strict";
import { access, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { createWorkspaceUsersService } from "../services/workspace-users-service.js";

async function createTempDir(prefix = "noobot-workspace-users-test-") {
  return mkdtemp(path.join(os.tmpdir(), prefix));
}

async function waitForFile(file, { timeoutMs = 1000 } = {}) {
  const deadline = Date.now() + timeoutMs;
  let lastError;
  while (Date.now() < deadline) {
    try {
      await access(file);
      return;
    } catch (error) {
      lastError = error;
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
  }
  throw lastError;
}

async function readJsonl(file) {
  const text = await readFile(file, "utf8");
  return text.trim().split("\n").filter(Boolean).map((line) => JSON.parse(line));
}

test("workspace-users-service: writes sanitized system event for users config read failure", async () => {
  const tempDir = await createTempDir();
  const workspaceRoot = path.join(tempDir, "workspace-secret-token");
  const runtimeRoot = path.join(tempDir, "runtime-root");
  try {
    await mkdir(workspaceRoot, { recursive: true });
    await writeFile(path.join(workspaceRoot, "user.json"), "{ invalid SECRET_VALUE apikey=TOKEN", "utf8");

    const service = createWorkspaceUsersService({
      workspaceRootPath: () => workspaceRoot,
      defaultWorkspaceUsersConfig: { users: [{ userId: "fallback", connectCode: "code" }] },
      runtimeEventsConfig: { workspaceRoot: runtimeRoot },
    });

    assert.deepEqual(await service.readWorkspaceUsersConfig(), { users: [] });

    const eventFile = path.join(runtimeRoot, "system", "runtime", "events", "system", "service", "config.jsonl");
    await waitForFile(eventFile);
    const [record] = await readJsonl(eventFile);

    assert.equal(record.scope, "system");
    assert.equal(record.source, "service");
    assert.equal(record.category, "config");
    assert.equal(record.level, "warn");
    assert.equal(record.channel, "direct");
    assert.equal(record.event, "service.workspaceUsers.config.read.failed");
    assert.equal(Object.prototype.hasOwnProperty.call(record, "sessionId"), false);
    assert.deepEqual(record.data, {
      fileName: "user.json",
      filePathLength: path.join(workspaceRoot, "user.json").length,
      createIfMissing: false,
    });
    assert.ok(record.error);

    const serialized = JSON.stringify(record);
    assert.equal(serialized.includes("SECRET_VALUE"), false);
    assert.equal(serialized.includes("apikey=TOKEN"), false);
    assert.equal(serialized.includes("workspace-secret-token"), false);
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});
