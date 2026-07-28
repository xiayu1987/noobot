/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import assert from "node:assert/strict";
import test from "node:test";
import { access, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import {
  appendRollingJsonlArtifactLog,
  buildSessionArtifactFileMap,
  cleanupSessionArtifacts,
  inspectSessionArtifacts,
  migrateSessionArtifacts,
  persistSessionArtifactSnapshot,
  readJsonlArtifactFile,
  readSessionArtifact,
  readSessionArtifactSnapshot,
  repairSessionArtifacts,
  writeSessionArtifact,
} from "../../src/session/session-artifact-store.js";
import { SessionMutationCoordinator } from "../../src/session/session-mutation-coordinator.js";

async function withTemp(fn) {
  const root = await mkdtemp(path.join(tmpdir(), "noobot-artifact-v2-"));
  try { await fn(root); } finally { await rm(root, { recursive: true, force: true }); }
}

test("execution events roll by UTF-8 byte size and preserve order", async () => withTemp(async (root) => {
  await appendRollingJsonlArtifactLog({ sessionDir: root, log: { id: 1, text: "中文" }, maxSegmentBytes: 25 });
  await appendRollingJsonlArtifactLog({ sessionDir: root, log: { id: 2, text: "中文" }, maxSegmentBytes: 25 });
  const files = buildSessionArtifactFileMap(root);
  const index = JSON.parse(await readFile(path.join(files.executionEventsDir, "index.json"), "utf8"));
  assert.equal(index.segments.length, 2);
  assert.deepEqual(await readJsonlArtifactFile(files.executionEvents), [
    { id: 1, text: "中文" }, { id: 2, text: "中文" },
  ]);
}));

test("execution event reader streams ordered pages across segments", async () => withTemp(async (root) => {
  for (let id = 0; id < 12; id += 1) {
    await appendRollingJsonlArtifactLog({
      sessionDir: root,
      log: { id, text: `event-${id}` },
      maxSegmentBytes: 65,
    });
  }
  const files = buildSessionArtifactFileMap(root);
  assert.deepEqual(
    (await readJsonlArtifactFile(files.executionEvents, { skip: 4, limit: 5 })).map((item) => item.id),
    [4, 5, 6, 7, 8],
  );
  assert.deepEqual(await readJsonlArtifactFile(files.executionEvents, { skip: 20, limit: 5 }), []);
  assert.deepEqual(await readJsonlArtifactFile(files.executionEvents, { limit: 0 }), []);
}));

test("execution reset and concurrent appends keep a valid index", async () => withTemp(async (root) => {
  await Promise.all(Array.from({ length: 20 }, (_, id) => appendRollingJsonlArtifactLog({
    sessionDir: root, log: { id }, maxSegmentBytes: 80,
  })));
  let logs = await readJsonlArtifactFile(buildSessionArtifactFileMap(root).executionEvents);
  assert.equal(logs.length, 20);
  await appendRollingJsonlArtifactLog({ sessionDir: root, log: { id: 99 }, reset: true, maxSegmentBytes: 80 });
  logs = await readJsonlArtifactFile(buildSessionArtifactFileMap(root).executionEvents);
  assert.deepEqual(logs, [{ id: 99 }]);
}));

test("execution append repairs stale index counters before writing", async () => withTemp(async (root) => {
  const files = buildSessionArtifactFileMap(root);
  await appendRollingJsonlArtifactLog({ sessionDir: root, log: { id: 1 } });
  const indexPath = path.join(files.executionEventsDir, "index.json");
  const index = JSON.parse(await readFile(indexPath, "utf8"));
  index.segments[0].bytes = 0;
  index.segments[0].records = 0;
  await writeFile(indexPath, JSON.stringify(index), "utf8");

  await appendRollingJsonlArtifactLog({ sessionDir: root, log: { id: 2 } });

  assert.deepEqual(await readJsonlArtifactFile(files.executionEvents), [{ id: 1 }, { id: 2 }]);
  const repairedIndex = JSON.parse(await readFile(indexPath, "utf8"));
  assert.equal(repairedIndex.segments[0].records, 2);
}));

test("an oversized execution event stays whole in its own segment", async () => withTemp(async (root) => {
  await appendRollingJsonlArtifactLog({ sessionDir: root, log: { text: "x".repeat(100) }, maxSegmentBytes: 20 });
  const files = buildSessionArtifactFileMap(root);
  const index = JSON.parse(await readFile(path.join(files.executionEventsDir, "index.json"), "utf8"));
  assert.equal(index.segments.length, 1);
  assert.equal(index.segments[0].oversized, true);
  assert.equal((await readJsonlArtifactFile(files.executionEvents))[0].text.length, 100);
}));

test("session manifest stores ordered turn references and reads legacy and v2 sessions", async () => withTemp(async (root) => {
  const messages = [
    { role: "user", content: "u1", turnScopeId: "a" },
    { role: "assistant", content: "a1", turnScopeId: "a" },
    { role: "user", content: "u2", turnScopeId: "b" },
  ];
  await writeSessionArtifact({ sessionDir: root, sessionPayload: { sessionId: "s", messages } });
  const files = buildSessionArtifactFileMap(root);
  const manifest = JSON.parse(await readFile(files.session, "utf8"));
  assert.equal("messages" in manifest, false);
  assert.equal(manifest.turnOrder.length, 2);
  assert.equal(manifest.turnOrder[0].artifactOrdinal, 1);
  assert.equal("sequence" in manifest.turnOrder[0], false);
  assert.deepEqual((await readSessionArtifact({ sessionDir: root })).messages.map((m) => m.content), ["u1", "a1", "u2"]);

  const legacy = path.join(root, "legacy");
  await writeSessionArtifact({ sessionDir: legacy, sessionPayload: { sessionId: "unused", messages: [] } });
  await writeFile(path.join(legacy, "session.json"), JSON.stringify({ sessionId: "legacy", messages }), "utf8");
  assert.deepEqual((await readSessionArtifact({ sessionDir: legacy })).messages, messages);
}));

test("legacy artifacts migrate to turns and execution segments without changing order", async () => withTemp(async (root) => {
  const files = buildSessionArtifactFileMap(root);
  const messages = [
    { role: "user", content: "first", turnScopeId: "one" },
    { role: "assistant", content: "answer", turnScopeId: "one" },
    { role: "user", content: "second", turnScopeId: "two" },
  ];
  await writeFile(files.session, JSON.stringify({ sessionId: "legacy", messages }), "utf8");
  await writeFile(files.executionEvents, '{"id":1}\n{"id":2}\n', "utf8");
  const migrated = await migrateSessionArtifacts({ sessionDir: root });
  assert.deepEqual(migrated.session.messages.map((item) => item.content), ["first", "answer", "second"]);
  assert.deepEqual(migrated.executionLogs.map((item) => item.id), [1, 2]);
  const manifest = JSON.parse(await readFile(files.session, "utf8"));
  assert.equal("messages" in manifest, false);
  assert.equal(manifest.turnOrder.length, 2);
  await assert.rejects(readFile(files.executionEvents, "utf8"), { code: "ENOENT" });
}));

test("execution event readers report corrupted indexes, missing segments, and invalid JSONL", async () => withTemp(async (root) => {
  const files = buildSessionArtifactFileMap(root);
  await mkdir(files.executionEventsDir, { recursive: true });

  await writeFile(path.join(files.executionEventsDir, "index.json"), "{broken", "utf8");
  await assert.rejects(readJsonlArtifactFile(files.executionEvents), {
    code: "EXECUTION_EVENT_INDEX_CORRUPTED",
  });

  await writeFile(path.join(files.executionEventsDir, "index.json"), JSON.stringify({
    segments: [{ file: "segment-000001.jsonl" }],
  }), "utf8");
  await assert.rejects(readJsonlArtifactFile(files.executionEvents), {
    code: "EXECUTION_EVENT_SEGMENT_MISSING",
  });

  await writeFile(path.join(files.executionEventsDir, "segment-000001.jsonl"), "{broken\n", "utf8");
  await assert.rejects(readJsonlArtifactFile(files.executionEvents), {
    code: "EXECUTION_EVENT_JSONL_CORRUPTED",
  });

  await rm(files.executionEventsDir, { recursive: true, force: true });
  await writeFile(files.executionEvents, "{broken\n", "utf8");
  await assert.rejects(readJsonlArtifactFile(files.executionEvents), {
    code: "EXECUTION_EVENT_JSONL_CORRUPTED",
  });
}));

test("session turns preserve empty, missing, and non-contiguous scopes without reordering", async () => withTemp(async (root) => {
  const messages = [
    { role: "user", content: "legacy user" },
    { role: "assistant", content: "legacy answer" },
    { role: "user", content: "a first", turnScopeId: "a" },
    { role: "assistant", content: "a answer", turnScopeId: "a" },
    { role: "user", content: "b", turnScopeId: "b" },
    { role: "assistant", content: "a again", turnScopeId: "a" },
  ];
  await writeSessionArtifact({ sessionDir: root, sessionPayload: { sessionId: "edges", messages } });
  const files = buildSessionArtifactFileMap(root);
  const manifest = JSON.parse(await readFile(files.session, "utf8"));
  assert.deepEqual(manifest.turnOrder.map((turn) => turn.turnScopeId), ["", "a", "b", "a"]);
  assert.deepEqual(
    (await readSessionArtifact({ sessionDir: root })).messages.map(({ role, content, turnScopeId }) => ({ role, content, turnScopeId })),
    messages.map(({ role, content, turnScopeId = "" }) => ({ role, content, turnScopeId })),
  );

  await writeSessionArtifact({ sessionDir: root, sessionPayload: { sessionId: "empty", messages: [] } });
  const emptyManifest = JSON.parse(await readFile(files.session, "utf8"));
  assert.deepEqual(emptyManifest.turnOrder, []);
  assert.deepEqual((await readSessionArtifact({ sessionDir: root })).messages, []);
}));

test("session artifacts group interleaved messages by logical dialog without changing replay order", async () => withTemp(async (root) => {
  const messages = [
    { role: "user", content: "a user", dialogProcessId: "a", turnScopeId: "turn-a", frontendUserMessage: true, ts: "2026-01-01T00:00:00Z" },
    { role: "user", content: "b user", dialogProcessId: "b", turnScopeId: "turn-b", frontendUserMessage: true, ts: "2026-01-01T00:01:00Z" },
    { role: "assistant", content: "a late", dialogProcessId: "a", turnScopeId: "turn-a", ts: "2026-01-01T00:02:00Z" },
    { role: "assistant", content: "b answer", dialogProcessId: "b", turnScopeId: "turn-b", ts: "2026-01-01T00:03:00Z" },
  ];
  await writeSessionArtifact({ sessionDir: root, sessionPayload: { sessionId: "interleaved", messages } });

  const files = buildSessionArtifactFileMap(root);
  const manifest = JSON.parse(await readFile(files.session, "utf8"));
  assert.equal(manifest.schemaVersion, 4);
  assert.equal(manifest.messageIdentityVersion, 1);
  assert.deepEqual(manifest.turnOrder.map((turn) => turn.artifactOrdinal), [1, 2]);
  assert.equal(manifest.turnOrder.some((turn) => "sequence" in turn), false);
  assert.deepEqual(manifest.turnOrder.map(({ dialogProcessId, messageCount }) => ({ dialogProcessId, messageCount })), [
    { dialogProcessId: "a", messageCount: 2 },
    { dialogProcessId: "b", messageCount: 2 },
  ]);
  assert.equal(manifest.messageOrder.length, messages.length);
  assert.deepEqual(
    (await readSessionArtifact({ sessionDir: root })).messages.map((message) => message.content),
    messages.map((message) => message.content),
  );
}));

test("session artifact publication rejects duplicate persistent message UIDs", async () => withTemp(async (root) => {
  await assert.rejects(writeSessionArtifact({
    sessionDir: root,
    sessionPayload: {
      sessionId: "duplicate-uids",
      messages: [
        { messageUid: "sm_same", role: "user", content: "one", dialogProcessId: "d1", turnScopeId: "t1" },
        { messageUid: "sm_same", role: "assistant", content: "two", dialogProcessId: "d1", turnScopeId: "t1" },
      ],
    },
  }), (error) => error.code === "SESSION_MESSAGE_UID_DUPLICATE");
}));

test("session reader reports missing and corrupted turn artifacts", async () => withTemp(async (root) => {
  const files = buildSessionArtifactFileMap(root);
  await writeSessionArtifact({
    sessionDir: root,
    sessionPayload: { sessionId: "broken", messages: [{ role: "user", content: "x", turnScopeId: "x" }] },
  });
  const manifest = JSON.parse(await readFile(files.session, "utf8"));
  const turnFile = path.join(root, manifest.turnOrder[0].file);
  await rm(turnFile, { force: true });
  await assert.rejects(readSessionArtifact({ sessionDir: root }), { code: "SESSION_TURN_ARTIFACT_MISSING" });
  await writeFile(turnFile, "{broken", "utf8");
  await assert.rejects(readSessionArtifact({ sessionDir: root }), { code: "ARTIFACT_JSON_CORRUPTED" });
}));

test("artifact migration runs inside the supplied mutation lock", async () => withTemp(async (root) => {
  const files = buildSessionArtifactFileMap(root);
  await writeFile(files.session, JSON.stringify({
    sessionId: "legacy",
    messages: [{ role: "user", content: "one", turnScopeId: "one" }],
  }), "utf8");
  let lockCalls = 0;
  let held = false;
  const migrated = await migrateSessionArtifacts({
    sessionDir: root,
    withMutationLock: async (operation) => {
      lockCalls += 1;
      held = true;
      try { return await operation(); } finally { held = false; }
    },
    now: () => {
      assert.equal(held, true);
      return "2026-01-01T00:00:00.000Z";
    },
  });
  assert.equal(lockCalls, 1);
  assert.equal(held, false);
  assert.equal(migrated.session.messages[0].content, "one");
}));

test("mutation coordinator distinguishes nested re-entry from concurrent callers", async () => withTemp(async (root) => {
  const coordinator = new SessionMutationCoordinator({ timeoutMs: 2000, pollMs: 2 });
  const lockDir = path.join(root, ".lock");
  const order = [];
  let releaseFirst = null;
  const firstEntered = new Promise((resolve) => { releaseFirst = resolve; });
  const first = coordinator.run(lockDir, async () => {
    order.push("a-start");
    releaseFirst();
    await coordinator.run(lockDir, async () => order.push("a-nested"));
    await new Promise((resolve) => setTimeout(resolve, 20));
    order.push("a-end");
  });
  await firstEntered;
  await Promise.all([first, coordinator.run(lockDir, async () => order.push("b"))]);
  assert.deepEqual(order, ["a-start", "a-nested", "a-end", "b"]);
}));

test("inspect is read-only, repair is idempotent, and cleanup honors dry-run and isolation", async () => withTemp(async (root) => {
  const sessionDir = path.join(root, "session-a");
  await writeSessionArtifact({ sessionDir, sessionPayload: { sessionId: "a", messages: [{ role: "user", content: "x" }] } });
  const files = buildSessionArtifactFileMap(sessionDir);
  await appendRollingJsonlArtifactLog({ sessionDir, log: { id: 1 } });
  const indexPath = path.join(files.executionEventsDir, "index.json");
  const index = JSON.parse(await readFile(indexPath, "utf8"));
  index.segments[0].bytes = 0;
  index.segments[0].records = 0;
  await writeFile(indexPath, JSON.stringify(index), "utf8");
  const orphan = path.join(files.turnsDir, "turn-orphan.json");
  const temp = path.join(sessionDir, "write.tmp-1");
  const staging = `${sessionDir}.staging-dead`;
  const other = path.join(root, "session-b.staging-live");
  await writeFile(orphan, "{}", "utf8");
  await writeFile(temp, "x", "utf8");
  await mkdir(staging, { recursive: true });
  await mkdir(other, { recursive: true });
  const beforeIndex = await readFile(indexPath, "utf8");
  assert.equal((await inspectSessionArtifacts({ sessionDir })).ok, false);
  assert.equal(await readFile(indexPath, "utf8"), beforeIndex);
  const firstRepair = await repairSessionArtifacts({ sessionDir });
  assert.deepEqual(firstRepair.repaired, ["segment-000001.jsonl"]);
  assert.deepEqual((await repairSessionArtifacts({ sessionDir })).repaired, []);
  const dry = await cleanupSessionArtifacts({ sessionDir });
  assert.equal(dry.dryRun, true);
  await access(orphan); await access(temp); await access(staging);
  const cleaned = await cleanupSessionArtifacts({ sessionDir, dryRun: false });
  assert.equal(cleaned.removed.includes(orphan), true);
  await assert.rejects(access(orphan), { code: "ENOENT" });
  await assert.rejects(access(temp), { code: "ENOENT" });
  await assert.rejects(access(staging), { code: "ENOENT" });
  await access(other);
}));


test("artifact mutation utilities honor deleted-session lifecycle gates", async () => withTemp(async (root) => {
  const sessionDir = path.join(root, "deleted-session");
  const files = buildSessionArtifactFileMap(sessionDir);
  await mkdir(sessionDir, { recursive: true });
  await writeFile(files.session, JSON.stringify({
    sessionId: "deleted-session",
    messages: [{ role: "user", content: "legacy", turnScopeId: "one" }],
  }), "utf8");
  await writeFile(files.executionEvents, '{"id":1}\n', "utf8");
  const lockDir = path.join(root, ".lifecycle", "deleted-session.lock");
  const assertDeleted = () => false;

  await assert.rejects(migrateSessionArtifacts({
    sessionDir,
    sessionId: "deleted-session",
    mutationLockDir: lockDir,
    assertSessionWritable: assertDeleted,
  }), { code: "SESSION_DELETED" });
  assert.equal(JSON.parse(await readFile(files.session, "utf8")).messages[0].content, "legacy");
  await assert.rejects(access(files.executionEventsDir), { code: "ENOENT" });

  await appendRollingJsonlArtifactLog({ sessionDir, log: { id: 2 } });
  const indexPath = path.join(files.executionEventsDir, "index.json");
  const indexBefore = await readFile(indexPath, "utf8");
  await assert.rejects(repairSessionArtifacts({
    sessionDir,
    sessionId: "deleted-session",
    mutationLockDir: lockDir,
    assertSessionWritable: assertDeleted,
  }), { code: "SESSION_DELETED" });
  assert.equal(await readFile(indexPath, "utf8"), indexBefore);

  const temp = path.join(sessionDir, "zombie.tmp-1");
  await writeFile(temp, "z", "utf8");
  await assert.rejects(cleanupSessionArtifacts({
    sessionDir,
    sessionId: "deleted-session",
    dryRun: false,
    mutationLockDir: lockDir,
    assertSessionWritable: assertDeleted,
  }), { code: "SESSION_DELETED" });
  await access(temp);
  const cleaned = await cleanupSessionArtifacts({
    sessionDir,
    sessionId: "deleted-session",
    dryRun: false,
    mutationLockDir: lockDir,
    assertSessionWritable: assertDeleted,
    allowDeletedCleanup: true,
  });
  assert.equal(cleaned.removed.includes(temp), true);
  await assert.rejects(access(temp), { code: "ENOENT" });
}));

test("snapshot publishes committed artifacts and rejects incomplete new snapshots", async () => withTemp(async (root) => {
  const outputDir = path.join(root, "snapshot");
  await persistSessionArtifactSnapshot({
    outputDir,
    sessionPayload: { sessionId: "snapshot-session", messages: [{ role: "user", content: "hello" }] },
    executionPayload: { logs: [{ id: 1 }] },
  });
  const snapshot = await readSessionArtifactSnapshot({ outputDir, allowLegacy: false });
  assert.equal(snapshot.session.sessionId, "snapshot-session");
  await rm(path.join(outputDir, "COMMITTED"));
  await assert.rejects(readSessionArtifactSnapshot({ outputDir, allowLegacy: false }), { code: "SNAPSHOT_NOT_COMMITTED" });
}));


test("snapshot publish rejects deleted sessions and cleans staging without restoring backup", async () => withTemp(async (root) => {
  const outputDir = path.join(root, "snapshot-zombie");
  await persistSessionArtifactSnapshot({
    outputDir,
    sessionPayload: { sessionId: "zombie-snapshot", messages: [{ role: "user", content: "old" }] },
  });
  let deleted = false;
  const lockDir = path.join(root, ".lifecycle", "zombie.lock");
  await assert.rejects(persistSessionArtifactSnapshot({
    outputDir,
    sessionPayload: { sessionId: "zombie-snapshot", messages: [{ role: "user", content: "new" }] },
    mutationLockDir: lockDir,
    assertSessionWritable: () => {
      if (deleted) return false;
      deleted = true;
      return true;
    },
  }), { code: "SESSION_DELETED" });
  const snapshot = await readSessionArtifactSnapshot({ outputDir, allowLegacy: false });
  assert.equal(snapshot.session.messages[0].content, "old");
  const entries = await import("node:fs/promises").then(({ readdir }) => readdir(root));
  assert.equal(entries.some((name) => name.startsWith("snapshot-zombie.staging-")), false);
  assert.equal(entries.some((name) => name.startsWith("snapshot-zombie.backup-")), false);
}));
