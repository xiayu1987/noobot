/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import assert from "node:assert/strict";
import { access, mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import test from "node:test";
import { filePath as path } from "@noobot/path-resolver";
import { WORKSPACE_LAYOUT, WORKSPACE_LAYOUT_UPGRADE_OWNER } from "@noobot/workspace-protocol";
import { SNAPSHOT_VERSION } from "@noobot/context-protocol/policy/snapshot";
import { V3_MESSAGE_IDENTITY_KEY } from "@noobot/context-protocol/policy/snapshot-migration";
import { TEST_SCOPED_SESSION_ROOTS } from "./helpers/scoped-session-roots.js";
import { upgradeModelContextSnapshots } from "../src/workspace-lifecycle/model-context-snapshot-upgrade.js";

const SESSION = `${WORKSPACE_LAYOUT.SESSION_DIR}/s-1`;
const SNAPSHOT_DIR = `${SESSION}/model-message-snapshots`;
const identity = {
  userId: "u-1",
  sessionId: "s-1",
  parentSessionId: "",
  dialogProcessId: "dp-1",
  turnScopeId: "client-turn:t-1",
};

function v3Snapshot(version = 3) {
  const additional = { [V3_MESSAGE_IDENTITY_KEY]: "sm_user", dialogProcessId: "dp-1" };
  const message = {
    type: "human",
    content: "hello",
    additional_kwargs: additional,
    raw: { turnScopeId: "client-turn:t-1" },
    lc_kwargs: { content: "hello", additional_kwargs: additional, response_metadata: {} },
    summarized: false,
  };
  return {
    version,
    ...identity,
    createdAt: "2026-10-01T00:00:00.000Z",
    updatedAt: "2026-10-01T00:00:00.000Z",
    messageBlocks: { system: [], history: [], incremental: [message] },
    messages: [message],
    userMetaBackwrites: [],
    turnProgress: {},
  };
}

async function exists(filePath) {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function createWorkspace(t) {
  const base = await mkdtemp(path.join(os.tmpdir(), "noobot-snapshot-upgrade-"));
  t.after(() => rm(base, { recursive: true, force: true }));
  await mkdir(path.join(base, SNAPSHOT_DIR), { recursive: true });
  await writeFile(path.join(base, SESSION, "session.json"), "{}\n");
  return base;
}

test("v7 migrates v3 snapshots in place and quarantines unmappable ones", async (t) => {
  const base = await createWorkspace(t);
  const backupBase = path.join(base, "backup");
  const v3Path = `${SNAPSHOT_DIR}/dp-1__client-turn_t-1.json`;
  const v2Path = `${SNAPSHOT_DIR}/dp-1__client-turn_t-2.json`;
  await writeFile(path.join(base, v3Path), JSON.stringify(v3Snapshot()));
  await writeFile(path.join(base, v2Path), JSON.stringify(v3Snapshot(2)));

  const result = await upgradeModelContextSnapshots({
    base,
    backupBase,
    scopedSessionRoots: TEST_SCOPED_SESSION_ROOTS,
  });

  assert.deepEqual(
    result.migrated.map(({ path: filePath, fromVersion, toVersion }) => ({
      filePath,
      fromVersion,
      toVersion,
    })),
    [{ filePath: v3Path, fromVersion: 3, toVersion: SNAPSHOT_VERSION }],
  );
  const migrated = JSON.parse(await readFile(path.join(base, v3Path), "utf8"));
  assert.equal(migrated.version, SNAPSHOT_VERSION);
  assert.deepEqual(migrated.messageBlocks.incremental[0].additional_kwargs, {
    messageUid: "sm_user",
    dialogProcessId: "dp-1",
    turnScopeId: "client-turn:t-1",
  });
  assert.equal(JSON.parse(await readFile(path.join(backupBase, v3Path), "utf8")).version, 3);

  assert.equal(result.quarantined.length, 1);
  assert.equal(result.quarantined[0].path, v2Path);
  assert.equal(result.quarantined[0].error.details.reason, "unsupported_version");
  assert.equal(await exists(path.join(base, v2Path)), false);
  const quarantined = path.join(
    base,
    WORKSPACE_LAYOUT.MIGRATION_QUARANTINE_DIR,
    WORKSPACE_LAYOUT_UPGRADE_OWNER.MODEL_CONTEXT_SNAPSHOT,
    v2Path,
  );
  assert.equal(JSON.parse(await readFile(quarantined, "utf8")).version, 2);
});

test("v7 leaves current snapshots untouched", async (t) => {
  const base = await createWorkspace(t);
  const filePath = path.join(base, SNAPSHOT_DIR, "dp-1__client-turn_t-1.json");
  const current = JSON.stringify({
    ...v3Snapshot(SNAPSHOT_VERSION),
    messageBlocks: {},
    messages: [],
  });
  await writeFile(filePath, current);
  const result = await upgradeModelContextSnapshots({
    base,
    backupBase: path.join(base, "backup"),
    scopedSessionRoots: TEST_SCOPED_SESSION_ROOTS,
  });
  assert.deepEqual(result, { migrated: [], quarantined: [] });
  assert.equal(await readFile(filePath, "utf8"), current);
});

test("v7 records a per-file I/O failure in place and keeps migrating the rest", async (t) => {
  const base = await createWorkspace(t);
  const backupBase = path.join(base, "backup");
  const blockedPath = `${SNAPSHOT_DIR}/dp-1__client-turn_t-1.json`;
  const okPath = `${SNAPSHOT_DIR}/dp-1__client-turn_t-2.json`;
  await writeFile(path.join(base, blockedPath), JSON.stringify(v3Snapshot()));
  await writeFile(path.join(base, okPath), JSON.stringify(v3Snapshot()));
  await mkdir(path.join(backupBase, blockedPath), { recursive: true });

  const result = await upgradeModelContextSnapshots({
    base,
    backupBase,
    scopedSessionRoots: TEST_SCOPED_SESSION_ROOTS,
  });

  assert.deepEqual(
    result.migrated.map((entry) => entry.path),
    [okPath],
  );
  assert.equal(result.quarantined.length, 1);
  assert.equal(result.quarantined[0].path, blockedPath);
  assert.notEqual(result.quarantined[0].error.code, "MIGRATION_UNMAPPABLE");
  assert.equal(JSON.parse(await readFile(path.join(base, blockedPath), "utf8")).version, 3);
  const reason = JSON.parse(
    await readFile(
      path.join(
        base,
        WORKSPACE_LAYOUT.MIGRATION_QUARANTINE_DIR,
        WORKSPACE_LAYOUT_UPGRADE_OWNER.MODEL_CONTEXT_SNAPSHOT,
        `${blockedPath}.reason.json`,
      ),
      "utf8",
    ),
  );
  assert.equal(reason.moved, false);
});
