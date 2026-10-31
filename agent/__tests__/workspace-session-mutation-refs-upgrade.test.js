/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import assert from "node:assert/strict";
import test from "node:test";
import path from "node:path";
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { MESSAGE_ORIGIN, SESSION_ERROR_CODE } from "@noobot/session-protocol";
import { FILE_MUTATION_VERSION, isMutationRef } from "@noobot/file-mutation-protocol";
import { upgradeSessionMutationRefs } from "../src/workspace-lifecycle/session-mutation-refs-upgrade.js";
import { readSessionArtifact } from "../src/session/session-artifact-store.js";
import { TEST_STORAGE_SERVICE } from "./helpers/storage-service.js";
import { buildHarness } from "./session/scoped-session-repositories.fixtures.js";
import {
  applySessionMessageFacts,
  createTestSessionRequiredFields,
} from "./helpers/session-message-facts.js";
import { SESSION_ID, v9Options } from "./helpers/session-identity-upgrade.fixtures.js";

const HOST_PATH = "/repo/src/a.js";
const WORKSPACE_PATH = "notes/b.md";
const SCOPE = "client-turn:t1";

function v2Mutation(id, logicalPath, { revision = null, sha = "after-1" } = {}) {
  return {
    id,
    operation: revision ? "update" : "create",
    path: logicalPath,
    fileName: path.basename(logicalPath),
    before: { exists: false, isText: true, size: 0, sha256: null, snapshotRef: null },
    after: {
      exists: true,
      isText: true,
      size: 3,
      sha256: sha,
      snapshotRef: { mutationId: id, section: "after" },
    },
    diff: { format: "git-lines-v1", additions: 1, deletions: 0, changedLines: 1 },
    aggregate: revision
      ? { scopeId: SCOPE, path: logicalPath, revision, diffCount: revision }
      : null,
    updatedAt: "2026-01-01T00:00:00.000Z",
  };
}

function v2Record(mutation) {
  return {
    protocol: "noobot.file-mutation-result",
    version: 2,
    ok: true,
    mutations: [mutation],
    snapshots: { before: "", after: "abc", diff: { lines: [] } },
  };
}

function toolPathRef(logicalPath) {
  return path.isAbsolute(logicalPath)
    ? { view: "host", path: logicalPath }
    : { view: "workspace", path: logicalPath };
}

function workspaceChange() {
  return { path: toolPathRef(WORKSPACE_PATH), action: "write" };
}

function toolPathFields(toolName, mutations) {
  if (toolName === "patch_file") {
    return {
      changes: mutations.map((mutation) => ({ path: toolPathRef(mutation.path), action: "write" })),
    };
  }
  const [target] = mutations;
  return target ? { path: toolPathRef(target.path), fileName: target.fileName } : {};
}

function toolResult(toolName, mutations, extra = {}) {
  return JSON.stringify({
    toolName,
    ok: true,
    protocol: "noobot.file-mutation-result",
    version: 2,
    ...toolPathFields(toolName, mutations),
    mutations,
    ...extra,
  });
}

let ordinal = 0;
function message(messageUid, role, extra) {
  ordinal += 1;
  return {
    sessionId: SESSION_ID,
    messageUid,
    role,
    content: messageUid,
    attachments: [],
    dialogProcessId: "d1",
    turnScopeId: SCOPE,
    ts: new Date(Date.UTC(2026, 0, 1, 0, 0, ordinal)).toISOString(),
    ...extra,
  };
}

function toolMessage(uid, toolName, content) {
  return message(uid, "tool", {
    type: "tool_result",
    tool_call_id: `call-${uid}`,
    toolName,
    content,
    presentationMessageId: "pm_1",
  });
}

function compactingCheckpoint(messageUids) {
  return {
    [SCOPE]: {
      dialogProcessId: "d1",
      turnScopeId: SCOPE,
      checkpointRevision: 1,
      receipts: [
        {
          checkpointId: "checkpoint-1",
          checkpointRevision: 1,
          requestHash: "sha256:fixture",
          persistedMessageUids: messageUids,
          summarizedMessageUids: messageUids.slice(0, 1),
          retainedMessageUids: [],
          markedCount: 1,
          committedAt: "2026-01-01T00:00:00.000Z",
        },
      ],
    },
  };
}

async function seed({ sessionRepo, toolMessages, records, compacted = false, finalReply = false }) {
  const persistenceContext = sessionRepo.treePersistenceContext("alice", SESSION_ID);
  const calls = toolMessages.map((item) => ({
    id: item.tool_call_id,
    type: "function",
    function: { name: item.toolName, arguments: "{}" },
  }));
  const messages = [
    message("m1", "user", { messageOrigin: MESSAGE_ORIGIN.NATURAL }),
    message("m2", "assistant", {
      type: "tool_call",
      tool_calls: calls,
      modelMessageId: "mm_m2",
      presentationMessageId: "pm_1",
    }),
    ...toolMessages,

    ...(finalReply
      ? [message("m3", "assistant", { modelMessageId: "mm_m3", presentationMessageId: "pm_1" })]
      : []),
  ];
  await sessionRepo.save(
    "alice",
    applySessionMessageFacts({
      ...createTestSessionRequiredFields(),
      sessionId: SESSION_ID,
      aggregateVersion: 0,
      messages,
      ...(compacted
        ? {
            turnSummaryCheckpoints: compactingCheckpoint(messages.map((item) => item.messageUid)),
          }
        : {}),
    }),
    { createOnly: true, persistenceContext },
  );
  const { sessionDir } = await sessionRepo.requireSessionScope(
    "alice",
    SESSION_ID,
    persistenceContext,
  );
  const root = path.join(sessionDir, "file-mutations");
  await mkdir(root, { recursive: true });
  for (const record of records) {
    await writeFile(path.join(root, `${record.mutations[0].id}.json`), JSON.stringify(record));
  }
  return sessionDir;
}

async function readRecord(sessionDir, id) {
  return JSON.parse(await readFile(path.join(sessionDir, "file-mutations", `${id}.json`), "utf8"));
}

async function toolMessagesOf(sessionDir) {
  const session = await readSessionArtifact({ storageService: TEST_STORAGE_SERVICE, sessionDir });
  return Object.fromEntries(
    session.messages.filter((item) => item.role === "tool").map((item) => [item.messageUid, item]),
  );
}

async function withHarness(fn) {
  const harness = buildHarness();
  const context = await harness.setup();
  try {
    await fn(context);
  } finally {
    await harness.cleanup();
  }
}

test("v20 migrates v2 records to locators and rebuilds mutationRefs from committed tool results", async () => {
  await withHarness(async ({ sessionRepo, root }) => {
    const host = v2Mutation("11111111-1111-4111-8111-111111111111", HOST_PATH);
    const workspaceFirst = v2Mutation("22222222-2222-4222-8222-222222222222", WORKSPACE_PATH, {
      revision: 1,
      sha: "after-1",
    });
    const workspaceLatest = v2Mutation(workspaceFirst.id, WORKSPACE_PATH, {
      revision: 2,
      sha: "after-2",
    });
    const sessionDir = await seed({
      sessionRepo,
      records: [v2Record(host), v2Record(workspaceLatest)],
      toolMessages: [
        toolMessage("t1", "write_file", toolResult("write_file", [host])),
        toolMessage("t2", "patch_file", toolResult("patch_file", [workspaceFirst])),
        toolMessage("t3", "patch_file", toolResult("patch_file", [workspaceLatest])),
        toolMessage("t4", "patch_file", toolResult("patch_file", [host], { ok: false })),
        toolMessage(
          "t5",
          "patch_file",
          toolResult("patch_file", [], { dryRun: true, changes: [workspaceChange()] }),
        ),
        toolMessage(
          "t6",
          "patch_file",
          toolResult("patch_file", [], { changes: [workspaceChange()] }),
        ),
        toolMessage("t7", "read_file", toolResult("read_file", [host])),
      ],
    });
    const options = v9Options(root);
    const result = await upgradeSessionMutationRefs(options);
    assert.deepEqual(result.quarantined, []);
    assert.equal(result.sessions.length, 1);
    assert.equal(result.sessions[0].rebuiltMessages, 3);
    assert.equal(result.sessions[0].migratedRecords, 2);

    const hostRecord = await readRecord(sessionDir, host.id);
    assert.equal(hostRecord.version, FILE_MUTATION_VERSION);
    assert.deepEqual(hostRecord.mutations[0].locator, { view: "host", path: HOST_PATH });
    assert.equal("path" in hostRecord.mutations[0], false);
    const aggregateRecord = await readRecord(sessionDir, workspaceFirst.id);
    assert.deepEqual(aggregateRecord.mutations[0].locator, {
      view: "workspace",
      path: WORKSPACE_PATH,
    });
    assert.equal("path" in aggregateRecord.mutations[0].aggregate, false);
    assert.equal(aggregateRecord.snapshots.after, "abc");

    const tools = await toolMessagesOf(sessionDir);
    assert.ok(tools.t1.mutationRefs.every(isMutationRef));
    assert.deepEqual(tools.t1.mutationRefs[0].locator, { view: "host", path: HOST_PATH });

    assert.equal(tools.t2.mutationRefs[0].revision, 1);
    assert.equal(tools.t2.mutationRefs[0].afterSha256, "after-1");
    assert.equal(tools.t3.mutationRefs[0].revision, 2);
    for (const uid of ["t4", "t5", "t6", "t7"]) assert.equal(tools[uid].mutationRefs, undefined);

    assert.equal(JSON.parse(tools.t1.content).version, 2);

    const backups = await readdir(
      path.join(options.backupBase, path.relative(options.base, sessionDir), "file-mutations"),
    );
    assert.equal(backups.length, 2);

    const again = await upgradeSessionMutationRefs(options);
    assert.deepEqual(again, { sessions: [], quarantined: [] });
  });
});

test("v20 quarantines sessions whose facts disagree instead of guessing", async (t) => {
  const cases = [
    {
      name: "aggregate path mismatch",
      reason: "legacy_aggregate_path_mismatch",
      build() {
        const mutation = v2Mutation("33333333-3333-4333-8333-333333333333", WORKSPACE_PATH, {
          revision: 1,
        });
        const record = v2Record({
          ...mutation,
          aggregate: { ...mutation.aggregate, path: "other.md" },
        });
        return { records: [record], mutation };
      },
    },
    {
      name: "record missing",
      reason: "file_mutation_record_missing",
      build() {
        return {
          records: [],
          mutation: v2Mutation("44444444-4444-4444-8444-444444444444", HOST_PATH),
        };
      },
    },
    {
      name: "record locator mismatch",
      reason: "file_mutation_record_locator_mismatch",
      build() {
        const mutation = v2Mutation("55555555-5555-4555-8555-555555555555", HOST_PATH);
        return { records: [v2Record({ ...mutation, path: "/repo/other.js" })], mutation };
      },
    },
  ];
  for (const item of cases) {
    await t.test(item.name, () =>
      withHarness(async ({ sessionRepo, root }) => {
        const { records, mutation } = item.build();
        const sessionDir = await seed({
          sessionRepo,
          records,
          toolMessages: [toolMessage("t1", "write_file", toolResult("write_file", [mutation]))],
        });
        const result = await upgradeSessionMutationRefs(v9Options(root));
        assert.deepEqual(result.sessions, []);
        assert.equal(result.quarantined.length, 1);
        assert.equal(result.quarantined[0].error.details.reason, item.reason);
        const tools = await toolMessagesOf(sessionDir);
        assert.equal(tools.t1.mutationRefs, undefined);
        for (const record of records) {
          assert.equal((await readRecord(sessionDir, record.mutations[0].id)).version, 2);
        }
      }),
    );
  }
});

test("v20 quarantines a session an earlier upgrade left off the canonical journal schema", async () => {
  await withHarness(async ({ sessionRepo, root }) => {
    const mutation = v2Mutation("66666666-6666-4666-8666-666666666666", HOST_PATH);
    const record = v2Record(mutation);
    const sessionDir = await seed({
      sessionRepo,
      records: [record],
      toolMessages: [toolMessage("t1", "write_file", toolResult("write_file", [mutation]))],
    });
    const manifestPath = path.join(sessionDir, "session.json");
    const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
    await writeFile(manifestPath, JSON.stringify({ ...manifest, schemaVersion: 1 }));

    const result = await upgradeSessionMutationRefs(v9Options(root));
    assert.deepEqual(result.sessions, []);
    assert.equal(result.quarantined.length, 1);
    assert.equal(
      result.quarantined[0].error.details.reason,
      SESSION_ERROR_CODE.TURN_JOURNAL_SCHEMA_REQUIRED,
    );
    assert.equal((await readRecord(sessionDir, mutation.id)).version, 2);
  });
});

function collectMutationRefs(value, found = []) {
  if (Array.isArray(value)) {
    for (const item of value) collectMutationRefs(item, found);
  } else if (value && typeof value === "object") {
    if (Array.isArray(value.mutationRefs)) found.push(...value.mutationRefs);
    for (const item of Object.values(value)) collectMutationRefs(item, found);
  }
  return found;
}

async function readManifest(sessionDir) {
  return JSON.parse(await readFile(path.join(sessionDir, "session.json"), "utf8"));
}

test("v20 invalidates the display summary revision so the read side rebuilds it with mutationRefs", async () => {
  await withHarness(async ({ sessionRepo, root }) => {
    const mutation = v2Mutation("77777777-7777-4777-8777-777777777777", HOST_PATH);
    await seed({
      sessionRepo,
      finalReply: true,
      records: [v2Record(mutation)],
      toolMessages: [toolMessage("t1", "write_file", toolResult("write_file", [mutation]))],
    });
    const persistenceContext = sessionRepo.treePersistenceContext("alice", SESSION_ID);
    const before = await sessionRepo.readSessionDisplaySummary("alice", SESSION_ID, {
      persistenceContext,
    });
    assert.deepEqual(collectMutationRefs(before), []);

    await upgradeSessionMutationRefs(v9Options(root));

    const after = await sessionRepo.readSessionDisplaySummary("alice", SESSION_ID, {
      persistenceContext,
    });
    assert.notEqual(after.source.revision, before.source.revision);
    assert.equal(after.stats.unassignedToolArtifactCount, 0);
    const refs = collectMutationRefs(after);
    assert.ok(refs.length > 0);
    assert.ok(refs.every((ref) => ref.mutationId === mutation.id && isMutationRef(ref)));
  });
});

test("v20 keeps compacted turn snapshots immutable and overrides them through journal upserts", async () => {
  await withHarness(async ({ sessionRepo, root }) => {
    const mutation = v2Mutation("88888888-8888-4888-8888-888888888888", HOST_PATH);
    const sessionDir = await seed({
      sessionRepo,
      compacted: true,
      records: [v2Record(mutation)],
      toolMessages: [toolMessage("t1", "write_file", toolResult("write_file", [mutation]))],
    });
    const [seededTurn] = (await readManifest(sessionDir)).turnOrder;
    assert.equal(seededTurn.summarySnapshots.length, 1);
    const [snapshotIndex] = seededTurn.summarySnapshots;
    const snapshotText = await readFile(path.join(sessionDir, snapshotIndex.file), "utf8");

    const result = await upgradeSessionMutationRefs(v9Options(root));
    assert.deepEqual(result.quarantined, []);
    assert.equal(result.sessions[0].rebuiltMessages, 1);

    const [turn] = (await readManifest(sessionDir)).turnOrder;
    assert.deepEqual(turn.summarySnapshots, seededTurn.summarySnapshots);
    assert.equal(await readFile(path.join(sessionDir, snapshotIndex.file), "utf8"), snapshotText);
    assert.notEqual(turn.messageHashes.t1, seededTurn.messageHashes.t1);
    const journal = (await readFile(path.join(sessionDir, turn.file), "utf8"))
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line));
    const upserted = journal.filter((record) => record.messageUid === "t1");
    assert.equal(upserted.length, 1);
    assert.equal(upserted[0].hash, turn.messageHashes.t1);

    const tools = await toolMessagesOf(sessionDir);
    assert.equal(tools.t1.mutationRefs[0].mutationId, mutation.id);
    assert.deepEqual(await upgradeSessionMutationRefs(v9Options(root)), {
      sessions: [],
      quarantined: [],
    });
  });
});
