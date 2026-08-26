/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import assert from "node:assert/strict";
import test from "node:test";
import { access, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";

import {
  appendRollingJsonlArtifactLog,
  buildSessionArtifactFileMap,
  cleanupSessionArtifacts,
  inspectSessionArtifacts,
  persistSessionArtifactSnapshot,
  readJsonlArtifactFile,
  readSessionArtifact,
  readSessionArtifactSnapshot,
  repairSessionArtifacts,
  writeSessionArtifact as writeSessionArtifactCanonical,
} from "../../src/session/session-artifact-store.js";
import { SessionMutationCoordinator } from "../../src/session/session-mutation-coordinator.js";
import {
  canonicalMessages,
  withTemp,
  writeSessionArtifact,
} from "./session-artifact-store-v2.test-helpers.js";

test("execution events roll by UTF-8 byte size and preserve order", async () =>
  withTemp(async (root) => {
    await appendRollingJsonlArtifactLog({
      sessionDir: root,
      log: { id: 1, text: "中文" },
      maxSegmentBytes: 25,
    });
    await appendRollingJsonlArtifactLog({
      sessionDir: root,
      log: { id: 2, text: "中文" },
      maxSegmentBytes: 25,
    });
    const files = buildSessionArtifactFileMap(root);
    const index = JSON.parse(
      await readFile(path.join(files.executionEventsDir, "index.json"), "utf8"),
    );
    assert.equal(index.segments.length, 2);
    assert.deepEqual(await readJsonlArtifactFile(files.executionEvents), [
      { id: 1, text: "中文" },
      { id: 2, text: "中文" },
    ]);
  }));

test("execution event reader streams ordered pages across segments", async () =>
  withTemp(async (root) => {
    for (let id = 0; id < 12; id += 1) {
      await appendRollingJsonlArtifactLog({
        sessionDir: root,
        log: { id, text: `event-${id}` },
        maxSegmentBytes: 65,
      });
    }
    const files = buildSessionArtifactFileMap(root);
    assert.deepEqual(
      (await readJsonlArtifactFile(files.executionEvents, { skip: 4, limit: 5 })).map(
        (item) => item.id,
      ),
      [4, 5, 6, 7, 8],
    );
    assert.deepEqual(
      await readJsonlArtifactFile(files.executionEvents, { skip: 20, limit: 5 }),
      [],
    );
    assert.deepEqual(await readJsonlArtifactFile(files.executionEvents, { limit: 0 }), []);
  }));

test("execution reset and concurrent appends keep a valid index", async () =>
  withTemp(async (root) => {
    await Promise.all(
      Array.from({ length: 20 }, (_, id) =>
        appendRollingJsonlArtifactLog({
          sessionDir: root,
          log: { id },
          maxSegmentBytes: 80,
        }),
      ),
    );
    let logs = await readJsonlArtifactFile(buildSessionArtifactFileMap(root).executionEvents);
    assert.equal(logs.length, 20);
    await appendRollingJsonlArtifactLog({
      sessionDir: root,
      log: { id: 99 },
      reset: true,
      maxSegmentBytes: 80,
    });
    logs = await readJsonlArtifactFile(buildSessionArtifactFileMap(root).executionEvents);
    assert.deepEqual(logs, [{ id: 99 }]);
  }));

test("execution append repairs stale index counters before writing", async () =>
  withTemp(async (root) => {
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

test("an oversized execution event stays whole in its own segment", async () =>
  withTemp(async (root) => {
    await appendRollingJsonlArtifactLog({
      sessionDir: root,
      log: { text: "x".repeat(100) },
      maxSegmentBytes: 20,
    });
    const files = buildSessionArtifactFileMap(root);
    const index = JSON.parse(
      await readFile(path.join(files.executionEventsDir, "index.json"), "utf8"),
    );
    assert.equal(index.segments.length, 1);
    assert.equal(index.segments[0].oversized, true);
    assert.equal((await readJsonlArtifactFile(files.executionEvents))[0].text.length, 100);
  }));

test("session manifest stores ordered turn references and rejects noncanonical sessions", async () =>
  withTemp(async (root) => {
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
    assert.deepEqual(
      (await readSessionArtifact({ sessionDir: root })).messages.map((m) => m.content),
      ["u1", "a1", "u2"],
    );

    const legacy = path.join(root, "legacy");
    await writeSessionArtifact({
      sessionDir: legacy,
      sessionPayload: { sessionId: "unused", messages: [] },
    });
    await writeFile(
      path.join(legacy, "session.json"),
      JSON.stringify({ sessionId: "legacy", messages }),
      "utf8",
    );
    await assert.rejects(readSessionArtifact({ sessionDir: legacy }), {
      code: "SESSION_TURN_JOURNAL_SCHEMA_REQUIRED",
    });
  }));

test("execution event readers report corrupted indexes, missing segments, and invalid JSONL", async () =>
  withTemp(async (root) => {
    const files = buildSessionArtifactFileMap(root);
    await mkdir(files.executionEventsDir, { recursive: true });

    await writeFile(path.join(files.executionEventsDir, "index.json"), "{broken", "utf8");
    await assert.rejects(readJsonlArtifactFile(files.executionEvents), {
      code: "EXECUTION_EVENT_INDEX_CORRUPTED",
    });

    await writeFile(
      path.join(files.executionEventsDir, "index.json"),
      JSON.stringify({
        segments: [{ file: "segment-000001.jsonl" }],
      }),
      "utf8",
    );
    await assert.rejects(readJsonlArtifactFile(files.executionEvents), {
      code: "EXECUTION_EVENT_SEGMENT_MISSING",
    });

    await writeFile(
      path.join(files.executionEventsDir, "segment-000001.jsonl"),
      "{broken\n",
      "utf8",
    );
    await assert.rejects(readJsonlArtifactFile(files.executionEvents), {
      code: "EXECUTION_EVENT_JSONL_CORRUPTED",
    });

    await rm(files.executionEventsDir, { recursive: true, force: true });
    await writeFile(files.executionEvents, "{broken\n", "utf8");
    await assert.rejects(readJsonlArtifactFile(files.executionEvents), {
      code: "EXECUTION_EVENT_JSONL_CORRUPTED",
    });
  }));

test("session turns preserve non-contiguous scopes without reordering and reject missing Turn identity", async () =>
  withTemp(async (root) => {
    const messages = [
      { role: "user", content: "a first", turnScopeId: "a" },
      { role: "assistant", content: "a answer", turnScopeId: "a" },
      { role: "user", content: "b", turnScopeId: "b" },
      { role: "assistant", content: "a again", turnScopeId: "a" },
    ];
    await writeSessionArtifact({
      sessionDir: root,
      sessionPayload: { sessionId: "edges", messages },
    });
    const files = buildSessionArtifactFileMap(root);
    const manifest = JSON.parse(await readFile(files.session, "utf8"));
    assert.deepEqual(
      manifest.turnOrder.map((turn) => turn.turnScopeId),
      ["a", "b"],
    );
    assert.deepEqual(
      (await readSessionArtifact({ sessionDir: root })).messages.map(
        ({ role, content, turnScopeId }) => ({ role, content, turnScopeId }),
      ),
      messages.map(({ role, content, turnScopeId = "" }) => ({ role, content, turnScopeId })),
    );

    await writeSessionArtifact({
      sessionDir: root,
      sessionPayload: { sessionId: "empty", messages: [] },
    });
    const emptyManifest = JSON.parse(await readFile(files.session, "utf8"));
    assert.deepEqual(emptyManifest.turnOrder, []);
    assert.deepEqual((await readSessionArtifact({ sessionDir: root })).messages, []);

    await assert.rejects(
      writeSessionArtifactCanonical({
        sessionDir: root,
        sessionPayload: {
          sessionId: "missing-turn-identity",
          messages: [{ messageUid: "sm_missing_turn", role: "user", content: "invalid" }],
        },
      }),
      { code: "SESSION_TURN_IDENTITY_REQUIRED" },
    );
  }));

test("session artifacts group interleaved messages by logical dialog without changing replay order", async () =>
  withTemp(async (root) => {
    const messages = [
      {
        role: "user",
        content: "a user",
        dialogProcessId: "a",
        turnScopeId: "turn-a",
        messageOrigin: "natural",
        userMetaMaterialized: true,
        ts: "2026-01-01T00:00:00Z",
      },
      {
        role: "user",
        content: "b user",
        dialogProcessId: "b",
        turnScopeId: "turn-b",
        messageOrigin: "natural",
        userMetaMaterialized: true,
        ts: "2026-01-01T00:01:00Z",
      },
      {
        role: "assistant",
        content: "a late",
        dialogProcessId: "a",
        turnScopeId: "turn-a",
        ts: "2026-01-01T00:02:00Z",
      },
      {
        role: "assistant",
        content: "b answer",
        dialogProcessId: "b",
        turnScopeId: "turn-b",
        ts: "2026-01-01T00:03:00Z",
      },
    ];
    await writeSessionArtifact({
      sessionDir: root,
      sessionPayload: { sessionId: "interleaved", messages },
    });

    const files = buildSessionArtifactFileMap(root);
    const manifest = JSON.parse(await readFile(files.session, "utf8"));
    assert.equal(manifest.schemaVersion, 6);
    assert.equal(manifest.messageIdentityVersion, 1);
    assert.deepEqual(
      manifest.turnOrder.map((turn) => turn.artifactOrdinal),
      [1, 2],
    );
    assert.equal(
      manifest.turnOrder.some((turn) => "sequence" in turn),
      false,
    );
    assert.deepEqual(
      manifest.turnOrder.map(({ dialogProcessId, messageCount }) => ({
        dialogProcessId,
        messageCount,
      })),
      [
        { dialogProcessId: "a", messageCount: 2 },
        { dialogProcessId: "b", messageCount: 2 },
      ],
    );
    assert.equal(manifest.messageOrder.length, messages.length);
    assert.deepEqual(
      (await readSessionArtifact({ sessionDir: root })).messages.map((message) => message.content),
      messages.map((message) => message.content),
    );
  }));

test("session artifact publication rejects duplicate persistent message UIDs", async () =>
  withTemp(async (root) => {
    await assert.rejects(
      writeSessionArtifact({
        sessionDir: root,
        sessionPayload: {
          sessionId: "duplicate-uids",
          messages: [
            {
              messageUid: "sm_same",
              role: "user",
              content: "one",
              dialogProcessId: "d1",
              turnScopeId: "t1",
            },
            {
              messageUid: "sm_same",
              role: "assistant",
              content: "two",
              dialogProcessId: "d1",
              turnScopeId: "t1",
            },
          ],
        },
      }),
      (error) => error instanceof TypeError && /duplicate_message_uid/.test(error.message),
    );
  }));

test("v6 turn journals append only changed messages and hide uncommitted tails", async () =>
  withTemp(async (root) => {
    const first = { role: "assistant", content: "one", turnScopeId: "active", messageUid: "m1" };
    const second = { role: "assistant", content: "two", turnScopeId: "active", messageUid: "m2" };
    await writeSessionArtifact({
      sessionDir: root,
      sessionPayload: { sessionId: "journal", messages: [first] },
    });
    const files = buildSessionArtifactFileMap(root);
    let manifest = JSON.parse(await readFile(files.session, "utf8"));
    const journal = path.join(root, manifest.turnOrder[0].file);
    const original = await readFile(journal, "utf8");
    await writeSessionArtifact({
      sessionDir: root,
      sessionPayload: { sessionId: "journal", messages: [first, second] },
    });
    manifest = JSON.parse(await readFile(files.session, "utf8"));
    const appended = await readFile(journal, "utf8");
    assert.equal(appended.startsWith(original), true);
    assert.equal(appended.length > original.length, true);
    await writeFile(journal, `${appended}{broken`, "utf8");
    const visible = await readSessionArtifact({ sessionDir: root });
    assert.deepEqual(
      visible.messages.map((message) => message.messageUid),
      ["m1", "m2"],
    );
  }));

test("summary checkpoints write immutable snapshots and journal indexes", async () =>
  withTemp(async (root) => {
    const messages = [
      {
        role: "user",
        content: "question",
        turnScopeId: "active",
        messageUid: "m1",
        ts: "2026-01-01T00:00:00.000Z",
      },
      {
        role: "assistant",
        content: "answer",
        turnScopeId: "active",
        messageUid: "m2",
        ts: "2026-01-01T00:00:00.000Z",
      },
    ];
    const receipt = {
      checkpointId: "checkpoint-1",
      checkpointRevision: 1,
      requestHash: "sha256:fixture",
      persistedMessageUids: ["m1", "m2"],
      summarizedMessageUids: ["m1"],
      committedAt: "2026-01-01T00:00:00.000Z",
    };
    const sessionPayload = {
      sessionId: "summary-journal",
      messages,
      turnSummaryCheckpoints: { active: { dialogProcessId: "dialog-active", receipts: [receipt] } },
    };
    await writeSessionArtifact({ sessionDir: root, sessionPayload });
    const files = buildSessionArtifactFileMap(root);
    const manifest = JSON.parse(await readFile(files.session, "utf8"));
    const journalFile = path.join(root, manifest.turnOrder[0].file);
    const journalRecords = (await readFile(journalFile, "utf8"))
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line));
    const index = journalRecords.find((record) => record.op === "summary_snapshot");
    assert.equal(index.checkpointId, "checkpoint-1");
    assert.equal(index.file, "turn-snapshots/turn-000001/checkpoint-000001.json");
    const snapshot = JSON.parse(await readFile(path.join(root, index.file), "utf8"));
    assert.equal(snapshot.schemaVersion, 2);
    assert.equal("messages" in snapshot, false);
    assert.deepEqual(
      snapshot.records.map((record) => record.messageUid),
      ["m1", "m2"],
    );
    const restored = await readSessionArtifact({ sessionDir: root });
    assert.deepEqual(
      restored.messages.map((message) => message.messageUid),
      ["m1", "m2"],
    );
    const turn = await (
      await import("../../src/session/session-artifact-session.js")
    ).readSessionTurn({ sessionDir: root, turnScopeId: "active" });
    assert.equal(turn.summarySnapshots.length, 1);
    assert.equal(turn.summarySnapshots[0].payload.checkpointId, "checkpoint-1");

    await writeSessionArtifact({ sessionDir: root, sessionPayload });
    const repeated = await readFile(journalFile, "utf8");
    const repeatedRecords = repeated
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line));
    assert.equal(repeatedRecords.filter((record) => record.op === "summary_snapshot").length, 1);

    const secondReceipt = {
      ...receipt,
      checkpointId: "checkpoint-2",
      checkpointRevision: 2,
      persistedMessageUids: ["m1", "m2", "m3"],
      summarizedMessageUids: ["m1", "m2"],
      committedAt: "2026-01-01T00:01:00.000Z",
    };
    const expandedPayload = {
      ...sessionPayload,
      messages: [
        ...messages,
        {
          role: "assistant",
          content: "follow-up",
          turnScopeId: "active",
          messageUid: "m3",
          ts: "2026-01-01T00:01:00.000Z",
        },
      ],
      turnSummaryCheckpoints: {
        active: { dialogProcessId: "dialog-active", receipts: [receipt, secondReceipt] },
      },
    };
    await writeSessionArtifact({ sessionDir: root, sessionPayload: expandedPayload });
    const indexedRecords = (await readFile(journalFile, "utf8"))
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line));
    assert.deepEqual(
      indexedRecords.map((record) => record.op),
      ["summary_snapshot", "summary_snapshot"],
    );
    const secondSnapshot = JSON.parse(
      await readFile(path.join(root, indexedRecords[1].file), "utf8"),
    );
    assert.deepEqual(
      secondSnapshot.records.map((record) => record.messageUid),
      ["m3"],
    );
    assert.equal(secondSnapshot.previousCheckpointHash, indexedRecords[0].contentHash);
    assert.deepEqual(
      (await readSessionArtifact({ sessionDir: root })).messages.map(
        (message) => message.messageUid,
      ),
      ["m1", "m2", "m3"],
    );

    await writeSessionArtifact({
      sessionDir: root,
      sessionPayload: {
        ...expandedPayload,
      },
    });
    const compactedRecords = (await readFile(journalFile, "utf8"))
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line));
    assert.deepEqual(
      compactedRecords.map((record) => record.op),
      ["summary_snapshot", "summary_snapshot"],
    );
    assert.deepEqual(
      (await readSessionArtifact({ sessionDir: root })).messages.map(
        (message) => message.messageUid,
      ),
      ["m1", "m2", "m3"],
    );
  }));

test("replacement turns receive a new stable journal identity instead of reusing the removed turn position", async () =>
  withTemp(async (root) => {
    const first = {
      messageUid: "m1",
      role: "user",
      content: "keep",
      dialogProcessId: "d1",
      turnScopeId: "t1",
    };
    const replaced = {
      messageUid: "m2",
      role: "user",
      content: "old",
      dialogProcessId: "d2",
      turnScopeId: "t2",
    };
    await writeSessionArtifact({
      sessionDir: root,
      sessionPayload: { sessionId: "replace", messages: [first, replaced] },
    });

    const files = buildSessionArtifactFileMap(root);
    let manifest = JSON.parse(await readFile(files.session, "utf8"));
    assert.deepEqual(
      manifest.turnOrder.map((turn) => turn.turnId),
      ["turn-000001", "turn-000002"],
    );
    assert.equal(manifest.turnArtifactSequence, 2);

    const replacement = {
      messageUid: "m3",
      role: "user",
      content: "new",
      dialogProcessId: "d3",
      turnScopeId: "t3",
    };
    await writeSessionArtifact({
      sessionDir: root,
      sessionPayload: { sessionId: "replace", messages: [first, replacement] },
    });
    manifest = JSON.parse(await readFile(files.session, "utf8"));

    assert.deepEqual(
      manifest.turnOrder.map((turn) => turn.turnId),
      ["turn-000001", "turn-000003"],
    );
    assert.deepEqual(
      manifest.turnOrder.map((turn) => turn.artifactOrdinal),
      [1, 2],
    );
    assert.equal(manifest.turnArtifactSequence, 3);
    assert.deepEqual(
      (await readSessionArtifact({ sessionDir: root })).messages.map((message) => message.content),
      ["keep", "new"],
    );
    await assert.rejects(access(path.join(files.turnsDir, "turn-000002.jsonl")), {
      code: "ENOENT",
    });

    const updatedReplacement = { ...replacement, content: "newer" };
    await writeSessionArtifact({
      sessionDir: root,
      sessionPayload: { sessionId: "replace", messages: [first, updatedReplacement] },
    });
    manifest = JSON.parse(await readFile(files.session, "utf8"));
    assert.deepEqual(
      manifest.turnOrder.map((turn) => turn.turnId),
      ["turn-000001", "turn-000003"],
    );
    assert.equal(manifest.turnArtifactSequence, 3);
    assert.deepEqual(
      (await readSessionArtifact({ sessionDir: root })).messages.map((message) => message.content),
      ["keep", "newer"],
    );
  }));

test("a stopped turn followed by continuation keeps distinct journal identities across refresh writes", async () =>
  withTemp(async (root) => {
    const stopped = {
      messageUid: "stopped",
      role: "assistant",
      content: "partial",
      dialogProcessId: "d-stop",
      turnScopeId: "t-stop",
    };
    await writeSessionArtifact({
      sessionDir: root,
      sessionPayload: {
        sessionId: "continue",
        messages: [stopped],
      },
    });
    const continuation = {
      messageUid: "continued",
      role: "assistant",
      content: "complete",
      dialogProcessId: "d-next",
      turnScopeId: "t-next",
    };
    await writeSessionArtifact({
      sessionDir: root,
      sessionPayload: {
        sessionId: "continue",
        messages: [stopped, continuation],
      },
    });
    const files = buildSessionArtifactFileMap(root);
    const manifest = JSON.parse(await readFile(files.session, "utf8"));
    assert.deepEqual(
      manifest.turnOrder.map((turn) => turn.turnId),
      ["turn-000001", "turn-000002"],
    );
    assert.equal(manifest.turnArtifactSequence, 2);
    assert.deepEqual(
      (await readSessionArtifact({ sessionDir: root })).messages.map((message) => message.content),
      ["partial", "complete"],
    );
  }));

test("session reader reports missing and corrupted turn artifacts", async () =>
  withTemp(async (root) => {
    const files = buildSessionArtifactFileMap(root);
    await writeSessionArtifact({
      sessionDir: root,
      sessionPayload: {
        sessionId: "broken",
        messages: [{ role: "user", content: "x", turnScopeId: "x" }],
      },
    });
    const manifest = JSON.parse(await readFile(files.session, "utf8"));
    const turnFile = path.join(root, manifest.turnOrder[0].file);
    await rm(turnFile, { force: true });
    await assert.rejects(readSessionArtifact({ sessionDir: root }), {
      code: "SESSION_TURN_ARTIFACT_MISSING",
    });
    await writeFile(turnFile, "{broken", "utf8");
    await assert.rejects(readSessionArtifact({ sessionDir: root }), {
      code: "ARTIFACT_JSON_CORRUPTED",
    });
  }));

test("mutation coordinator distinguishes nested re-entry from concurrent callers", async () =>
  withTemp(async (root) => {
    const coordinator = new SessionMutationCoordinator({ timeoutMs: 2000, pollMs: 2 });
    const lockDir = path.join(root, ".lock");
    const order = [];
    let releaseFirst = null;
    const firstEntered = new Promise((resolve) => {
      releaseFirst = resolve;
    });
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

test("inspect is read-only, repair is idempotent, and cleanup honors dry-run and isolation", async () =>
  withTemp(async (root) => {
    const sessionDir = path.join(root, "session-a");
    await writeSessionArtifact({
      sessionDir,
      sessionPayload: { sessionId: "a", messages: [{ role: "user", content: "x" }] },
    });
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
    await access(orphan);
    await access(temp);
    await access(staging);
    const cleaned = await cleanupSessionArtifacts({ sessionDir, dryRun: false });
    assert.equal(cleaned.removed.includes(orphan), true);
    await assert.rejects(access(orphan), { code: "ENOENT" });
    await assert.rejects(access(temp), { code: "ENOENT" });
    await assert.rejects(access(staging), { code: "ENOENT" });
    await access(other);
  }));

test("artifact mutation utilities honor deleted-session lifecycle gates", async () =>
  withTemp(async (root) => {
    const sessionDir = path.join(root, "deleted-session");
    const files = buildSessionArtifactFileMap(sessionDir);
    await mkdir(sessionDir, { recursive: true });
    await writeFile(
      files.session,
      JSON.stringify({
        sessionId: "deleted-session",
        messages: [{ role: "user", content: "legacy", turnScopeId: "one" }],
      }),
      "utf8",
    );
    await writeFile(files.executionEvents, '{"id":1}\n', "utf8");
    const lockDir = path.join(root, ".lifecycle", "deleted-session.lock");
    const assertDeleted = () => false;

    await appendRollingJsonlArtifactLog({ sessionDir, log: { id: 2 } });
    const indexPath = path.join(files.executionEventsDir, "index.json");
    const indexBefore = await readFile(indexPath, "utf8");
    await assert.rejects(
      repairSessionArtifacts({
        sessionDir,
        sessionId: "deleted-session",
        mutationLockDir: lockDir,
        assertSessionWritable: assertDeleted,
      }),
      { code: "SESSION_DELETED" },
    );
    assert.equal(await readFile(indexPath, "utf8"), indexBefore);

    const temp = path.join(sessionDir, "zombie.tmp-1");
    await writeFile(temp, "z", "utf8");
    await assert.rejects(
      cleanupSessionArtifacts({
        sessionDir,
        sessionId: "deleted-session",
        dryRun: false,
        mutationLockDir: lockDir,
        assertSessionWritable: assertDeleted,
      }),
      { code: "SESSION_DELETED" },
    );
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

test("snapshot publishes committed artifacts and rejects incomplete new snapshots", async () =>
  withTemp(async (root) => {
    const outputDir = path.join(root, "snapshot");
    await persistSessionArtifactSnapshot({
      outputDir,
      sessionPayload: {
        sessionId: "snapshot-session",
        messages: canonicalMessages([{ role: "user", content: "hello" }]),
      },
      executionPayload: { logs: [{ id: 1 }] },
    });
    const snapshot = await readSessionArtifactSnapshot({ outputDir, allowLegacy: false });
    assert.equal(snapshot.session.sessionId, "snapshot-session");
    await rm(path.join(outputDir, "COMMITTED"));
    await assert.rejects(readSessionArtifactSnapshot({ outputDir, allowLegacy: false }), {
      code: "SNAPSHOT_NOT_COMMITTED",
    });
  }));

test("snapshot publish rejects deleted sessions and cleans staging without restoring backup", async () =>
  withTemp(async (root) => {
    const outputDir = path.join(root, "snapshot-zombie");
    await persistSessionArtifactSnapshot({
      outputDir,
      sessionPayload: {
        sessionId: "zombie-snapshot",
        messages: canonicalMessages([{ role: "user", content: "old" }]),
      },
    });
    let deleted = false;
    const lockDir = path.join(root, ".lifecycle", "zombie.lock");
    await assert.rejects(
      persistSessionArtifactSnapshot({
        outputDir,
        sessionPayload: {
          sessionId: "zombie-snapshot",
          messages: canonicalMessages([{ role: "user", content: "new" }]),
        },
        mutationLockDir: lockDir,
        assertSessionWritable: () => {
          if (deleted) return false;
          deleted = true;
          return true;
        },
      }),
      { code: "SESSION_DELETED" },
    );
    const snapshot = await readSessionArtifactSnapshot({ outputDir, allowLegacy: false });
    assert.equal(snapshot.session.messages[0].content, "old");
    const entries = await import("node:fs/promises").then(({ readdir }) => readdir(root));
    assert.equal(
      entries.some((name) => name.startsWith("snapshot-zombie.staging-")),
      false,
    );
    assert.equal(
      entries.some((name) => name.startsWith("snapshot-zombie.backup-")),
      false,
    );
  }));
