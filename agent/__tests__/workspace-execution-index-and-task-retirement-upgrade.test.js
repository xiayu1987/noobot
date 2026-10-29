/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import assert from "node:assert/strict";
import { access, mkdtemp, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import test from "node:test";
import { filePath as path } from "@noobot/path-resolver";
import { WORKSPACE_LAYOUT, WORKSPACE_LAYOUT_UPGRADE_OWNER } from "@noobot/workspace-protocol";
import { EXECUTION_EVENT_INDEX_SCHEMA_VERSION } from "@noobot/session-protocol/execution-event-index";
import { TEST_SCOPED_SESSION_ROOTS } from "./helpers/scoped-session-roots.js";
import { TEST_STORAGE_SERVICE } from "./helpers/storage-service.js";
import { upgradeExecutionEventIndexes } from "../src/workspace-lifecycle/execution-event-index-upgrade.js";
import { retireSessionTaskArtifacts } from "../src/workspace-lifecycle/session-task-artifact-retirement.js";
import { readExecutionLogs } from "../src/session/session-artifact-execution-logs.js";

const SESSION = "runtime/session/s-1";
const EVENTS = `${SESSION}/execution-events`;
const TURN = `${EVENTS}/turns/d1`;
const SEGMENT = "segment-000001.jsonl";

async function createFixture() {
  const base = await mkdtemp(path.join(os.tmpdir(), "noobot-layout-17-18-"));
  const backupBase = path.join(base, WORKSPACE_LAYOUT.WORKSPACE_BACKUPS_DIR, "stamp");
  const at = (relativePath) => path.join(base, relativePath);
  const write = async (relativePath, value) => {
    await mkdir(path.dirname(at(relativePath)), { recursive: true });
    await writeFile(at(relativePath), typeof value === "string" ? value : JSON.stringify(value));
  };
  const exists = (relativePath) =>
    access(relativePath).then(
      () => true,
      () => false,
    );
  const options = {
    base,
    backupBase,
    scopedSessionRoots: TEST_SCOPED_SESSION_ROOTS,
    storageService: TEST_STORAGE_SERVICE,
  };
  return {
    base,
    backupBase,
    at,
    write,
    exists,
    options,
    readJson: async (relativePath) => JSON.parse(await readFile(at(relativePath), "utf8")),
    restore: () => rm(base, { recursive: true, force: true }),
  };
}

async function seedV2Indexes(fixture, turnIndex = {}) {
  await fixture.write(`${SESSION}/session.json`, { sessionId: "s-1" });
  await fixture.write(`${EVENTS}/index.json`, {
    schemaVersion: 2,
    turns: [{ dialogProcessId: "d1" }],
  });
  await fixture.write(`${TURN}/${SEGMENT}`, '{"dialogProcessId":"d1"}\n');
  await fixture.write(`${TURN}/index.json`, {
    schemaVersion: 2,
    dialogProcessId: "d1",
    activeSequence: 1,
    maxSegmentBytes: 1024,
    segments: [{ sequence: 1, file: SEGMENT, bytes: 25, records: 1, sealed: false }],
    ...turnIndex,
  });
}

test("v17 rewrites v2 execution indexes to v3, backs up originals and is idempotent", async () => {
  const fixture = await createFixture();
  try {
    await seedV2Indexes(fixture);
    const result = await upgradeExecutionEventIndexes(fixture.options);
    assert.deepEqual(result.quarantined, []);
    assert.equal(result.sessions.length, 1);
    assert.equal(result.sessions[0].turns, 1);
    assert.deepEqual(await fixture.readJson(`${EVENTS}/index.json`), {
      schemaVersion: EXECUTION_EVENT_INDEX_SCHEMA_VERSION,
      turns: [{ dialogProcessId: "d1" }],
    });
    assert.deepEqual(await fixture.readJson(`${TURN}/index.json`), {
      schemaVersion: EXECUTION_EVENT_INDEX_SCHEMA_VERSION,
      segments: [{ sequence: 1, file: SEGMENT, bytes: 25, records: 1, sealed: false }],
    });
    const backup = JSON.parse(
      await readFile(path.join(fixture.backupBase, TURN, "index.json"), "utf8"),
    );
    assert.equal(backup.schemaVersion, 2);
    assert.equal(backup.maxSegmentBytes, 1024);
    assert.deepEqual(
      await readExecutionLogs({
        storageService: TEST_STORAGE_SERVICE,
        sessionDir: fixture.at(SESSION),
      }),
      [{ dialogProcessId: "d1" }],
    );
    const again = await upgradeExecutionEventIndexes(fixture.options);
    assert.deepEqual(again, { sessions: [], quarantined: [] });
  } finally {
    await fixture.restore();
  }
});

test("v17 quarantines a session whose v2 turn index breaks the v2 contract", async () => {
  const fixture = await createFixture();
  try {
    await seedV2Indexes(fixture, { activeSequence: 2 });
    const result = await upgradeExecutionEventIndexes(fixture.options);
    assert.deepEqual(result.sessions, []);
    assert.equal(result.quarantined.length, 1);
    assert.equal(result.quarantined[0].path, SESSION);
    assert.equal(result.quarantined[0].error.code, "EXECUTION_EVENT_INDEX_CORRUPTED");
    assert.equal((await fixture.readJson(`${TURN}/index.json`)).schemaVersion, 2);
    const reasons = await readdir(
      fixture.at(
        `${WORKSPACE_LAYOUT.MIGRATION_QUARANTINE_DIR}/${WORKSPACE_LAYOUT_UPGRADE_OWNER.EXECUTION_EVENT_INDEX}/runtime/session`,
      ),
    );
    assert.deepEqual(reasons, ["s-1.reason.json"]);
  } finally {
    await fixture.restore();
  }
});

test("v17 quarantines an unsupported session index version", async () => {
  const fixture = await createFixture();
  try {
    await fixture.write(`${SESSION}/session.json`, { sessionId: "s-1" });
    await fixture.write(`${EVENTS}/index.json`, { schemaVersion: 1, segments: [] });
    const result = await upgradeExecutionEventIndexes(fixture.options);
    assert.equal(result.quarantined.length, 1);
    assert.equal(result.quarantined[0].error.code, "EXECUTION_EVENT_INDEX_SCHEMA_UNSUPPORTED");
  } finally {
    await fixture.restore();
  }
});

test("v18 retires task.json into the backup and creates nothing for sessions without it", async () => {
  const fixture = await createFixture();
  try {
    await fixture.write(`${SESSION}/session.json`, { sessionId: "s-1" });
    await fixture.write(`${SESSION}/task.json`, { tasks: [] });
    await fixture.write("runtime/session/s-2/session.json", { sessionId: "s-2" });
    const result = await retireSessionTaskArtifacts(fixture.options);
    assert.deepEqual(result.retired, [
      {
        path: `${SESSION}/task.json`,
        backupPath: path.join(fixture.backupBase, SESSION, "task.json"),
      },
    ]);
    assert.equal(await fixture.exists(fixture.at(`${SESSION}/task.json`)), false);
    assert.deepEqual(
      JSON.parse(await readFile(path.join(fixture.backupBase, SESSION, "task.json"), "utf8")),
      { tasks: [] },
    );
    assert.equal(await fixture.exists(path.join(fixture.backupBase, "runtime/session/s-2")), false);
    assert.deepEqual(await retireSessionTaskArtifacts(fixture.options), { retired: [] });
  } finally {
    await fixture.restore();
  }
});
