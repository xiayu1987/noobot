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
  SESSION_ARTIFACT_SCHEMA_VERSION,
  SESSION_ERROR_CODE,
  createSessionDeletedError,
} from "@noobot/session-protocol";

import {
  appendRollingJsonlArtifactLog,
  buildSessionArtifactFileMap,
  cleanupSessionArtifacts,
  inspectSessionArtifacts,
  readSessionArtifact,
  repairSessionArtifacts,
  writeSessionArtifact as writeSessionArtifactCanonical,
} from "../../src/session/session-artifact-store.js";
import {
  TEST_TURN,
  turnDirOf,
  withTemp,
  writeSessionArtifact,
} from "./session-artifact-store-v2.test-helpers.js";
import { createTestSessionRequiredFields } from "../helpers/session-message-facts.js";
import { TEST_MESSAGE_TS } from "../helpers/session-run-payload.js";

const allowSessionWrite = async () => {};

test("session manifest stores ordered turn references and rejects noncanonical sessions", async () =>
  withTemp(async (root) => {
    const messages = [
      { role: "user", messageOrigin: "natural", content: "u1", turnScopeId: "a" },
      { role: "assistant", presentationMessageId: "pm_fx1", content: "a1", turnScopeId: "a" },
      { role: "user", messageOrigin: "natural", content: "u2", turnScopeId: "b" },
    ];
    await writeSessionArtifact({
      sessionDir: root,
      sessionPayload: {
        ...createTestSessionRequiredFields(),
        sessionId: "s",
        aggregateVersion: 0,
        messages,
      },
    });
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
      sessionPayload: {
        ...createTestSessionRequiredFields(),
        sessionId: "unused",
        aggregateVersion: 0,
        messages: [],
      },
    });
    await writeFile(
      path.join(legacy, "session.json"),
      JSON.stringify({
        ...createTestSessionRequiredFields(),
        sessionId: "legacy",
        aggregateVersion: 0,
        messages,
      }),
      "utf8",
    );
    await assert.rejects(readSessionArtifact({ sessionDir: legacy }), {
      code: SESSION_ERROR_CODE.TURN_JOURNAL_SCHEMA_REQUIRED,
    });
  }));

test("session turns preserve non-contiguous scopes without reordering and reject missing Turn identity", async () =>
  withTemp(async (root) => {
    const messages = [
      { role: "user", messageOrigin: "natural", content: "a first", turnScopeId: "a" },
      { role: "assistant", presentationMessageId: "pm_fx2", content: "a answer", turnScopeId: "a" },
      { role: "user", messageOrigin: "natural", content: "b", turnScopeId: "b" },
      { role: "assistant", presentationMessageId: "pm_fx3", content: "a again", turnScopeId: "a" },
    ];
    await writeSessionArtifact({
      sessionDir: root,
      sessionPayload: {
        ...createTestSessionRequiredFields(),
        sessionId: "edges",
        aggregateVersion: 0,
        messages,
      },
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
      sessionPayload: {
        ...createTestSessionRequiredFields(),
        sessionId: "empty",
        aggregateVersion: 0,
        messages: [],
      },
    });
    const emptyManifest = JSON.parse(await readFile(files.session, "utf8"));
    assert.deepEqual(emptyManifest.turnOrder, []);
    assert.deepEqual((await readSessionArtifact({ sessionDir: root })).messages, []);

    await assert.rejects(
      writeSessionArtifactCanonical({
        sessionDir: root,
        sessionPayload: {
          ...createTestSessionRequiredFields(),
          sessionId: "missing-turn-identity",
          aggregateVersion: 0,
          messages: [
            {
              sessionId: "missing-turn-identity",
              messageUid: "sm_missing_turn",
              ts: TEST_MESSAGE_TS,
              role: "user",
              messageOrigin: "natural",
              content: "invalid",
            },
          ],
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
        ts: "2026-01-01T00:00:00.000Z",
      },
      {
        role: "user",
        content: "b user",
        dialogProcessId: "b",
        turnScopeId: "turn-b",
        messageOrigin: "natural",
        ts: "2026-01-01T00:01:00.000Z",
      },
      {
        role: "assistant",
        presentationMessageId: "pm_fx4",
        content: "a late",
        dialogProcessId: "a",
        turnScopeId: "turn-a",
        ts: "2026-01-01T00:02:00.000Z",
      },
      {
        role: "assistant",
        presentationMessageId: "pm_fx5",
        content: "b answer",
        dialogProcessId: "b",
        turnScopeId: "turn-b",
        ts: "2026-01-01T00:03:00.000Z",
      },
    ];
    await writeSessionArtifact({
      sessionDir: root,
      sessionPayload: {
        ...createTestSessionRequiredFields(),
        sessionId: "interleaved",
        aggregateVersion: 0,
        messages,
      },
    });

    const files = buildSessionArtifactFileMap(root);
    const manifest = JSON.parse(await readFile(files.session, "utf8"));
    assert.equal(manifest.schemaVersion, SESSION_ARTIFACT_SCHEMA_VERSION);
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
          ...createTestSessionRequiredFields(),
          sessionId: "duplicate-uids",
          aggregateVersion: 0,
          messages: [
            {
              messageUid: "sm_same",
              ts: TEST_MESSAGE_TS,
              role: "user",
              messageOrigin: "natural",
              content: "one",
              dialogProcessId: "d1",
              turnScopeId: "t1",
            },
            {
              messageUid: "sm_same",
              ts: TEST_MESSAGE_TS,
              role: "assistant",
              presentationMessageId: "pm_fx6",
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

test("canonical turn journals append only changed messages and hide uncommitted tails", async () =>
  withTemp(async (root) => {
    const first = {
      role: "assistant",
      presentationMessageId: "pm_fx7",
      content: "one",
      turnScopeId: "active",
      messageUid: "m1",
      ts: TEST_MESSAGE_TS,
    };
    const second = {
      role: "assistant",
      presentationMessageId: "pm_fx8",
      content: "two",
      turnScopeId: "active",
      messageUid: "m2",
      ts: TEST_MESSAGE_TS,
    };
    await writeSessionArtifact({
      sessionDir: root,
      sessionPayload: {
        ...createTestSessionRequiredFields(),
        sessionId: "journal",
        aggregateVersion: 0,
        messages: [first],
      },
    });
    const files = buildSessionArtifactFileMap(root);
    let manifest = JSON.parse(await readFile(files.session, "utf8"));
    const journal = path.join(root, manifest.turnOrder[0].file);
    const original = await readFile(journal, "utf8");
    await writeSessionArtifact({
      sessionDir: root,
      sessionPayload: {
        ...createTestSessionRequiredFields(),
        sessionId: "journal",
        aggregateVersion: 0,
        messages: [first, second],
      },
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

test("summary checkpoints write immutable snapshots indexed by the manifest", async () =>
  withTemp(async (root) => {
    const messages = [
      {
        role: "user",
        messageOrigin: "natural",
        content: "question",
        turnScopeId: "active",
        messageUid: "m1",
        ts: "2026-01-01T00:00:00.000Z",
      },
      {
        role: "assistant",
        presentationMessageId: "pm_fx9",
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
      retainedMessageUids: [],
      markedCount: 1,
      committedAt: "2026-01-01T00:00:00.000Z",
    };
    const sessionPayload = {
      ...createTestSessionRequiredFields(),
      sessionId: "summary-journal",
      aggregateVersion: 0,
      messages,
      turnSummaryCheckpoints: {
        active: {
          dialogProcessId: "dialog-active",
          turnScopeId: "active",
          checkpointRevision: 1,
          receipts: [receipt],
        },
      },
    };
    await writeSessionArtifact({ sessionDir: root, sessionPayload });
    const files = buildSessionArtifactFileMap(root);
    const readManifestTurn = async () =>
      JSON.parse(await readFile(files.session, "utf8")).turnOrder[0];
    const manifestTurn = await readManifestTurn();
    const journalFile = path.join(root, manifestTurn.file);
    assert.equal(await readFile(journalFile, "utf8"), "");
    assert.equal(manifestTurn.committedBytes, 0);
    assert.equal(manifestTurn.summarySnapshots.length, 1);
    const [index] = manifestTurn.summarySnapshots;
    assert.equal(index.checkpointId, "checkpoint-1");
    assert.equal("op" in index, false);
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
    assert.equal(turn.summarySnapshots[0].checkpointId, "checkpoint-1");

    await writeSessionArtifact({ sessionDir: root, sessionPayload });
    assert.deepEqual((await readManifestTurn()).summarySnapshots, [index]);
    assert.equal(await readFile(journalFile, "utf8"), "");

    const secondReceipt = {
      ...receipt,
      checkpointId: "checkpoint-2",
      checkpointRevision: 2,
      persistedMessageUids: ["m1", "m2", "m3"],
      summarizedMessageUids: ["m1", "m2"],
      markedCount: 2,
      committedAt: "2026-01-01T00:01:00.000Z",
    };
    const expandedPayload = {
      ...sessionPayload,
      messages: [
        ...messages,
        {
          role: "assistant",
          presentationMessageId: "pm_fx10",
          content: "follow-up",
          turnScopeId: "active",
          messageUid: "m3",
          ts: "2026-01-01T00:01:00.000Z",
        },
      ],
      turnSummaryCheckpoints: {
        active: {
          dialogProcessId: "dialog-active",
          turnScopeId: "active",
          checkpointRevision: 2,
          receipts: [receipt, secondReceipt],
        },
      },
    };
    await writeSessionArtifact({ sessionDir: root, sessionPayload: expandedPayload });
    const indexedRecords = (await readManifestTurn()).summarySnapshots;
    assert.deepEqual(
      indexedRecords.map((record) => record.checkpointId),
      ["checkpoint-1", "checkpoint-2"],
    );
    assert.equal(await readFile(journalFile, "utf8"), "");
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
    assert.deepEqual((await readManifestTurn()).summarySnapshots, indexedRecords);
    assert.equal(await readFile(journalFile, "utf8"), "");
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
      ts: TEST_MESSAGE_TS,
      role: "user",
      messageOrigin: "natural",
      content: "keep",
      dialogProcessId: "d1",
      turnScopeId: "t1",
    };
    const replaced = {
      messageUid: "m2",
      ts: TEST_MESSAGE_TS,
      role: "user",
      messageOrigin: "natural",
      content: "old",
      dialogProcessId: "d2",
      turnScopeId: "t2",
    };
    await writeSessionArtifact({
      sessionDir: root,
      sessionPayload: {
        ...createTestSessionRequiredFields(),
        sessionId: "replace",
        aggregateVersion: 0,
        messages: [first, replaced],
      },
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
      ts: TEST_MESSAGE_TS,
      role: "user",
      messageOrigin: "natural",
      content: "new",
      dialogProcessId: "d3",
      turnScopeId: "t3",
    };
    await writeSessionArtifact({
      sessionDir: root,
      sessionPayload: {
        ...createTestSessionRequiredFields(),
        sessionId: "replace",
        aggregateVersion: 0,
        messages: [first, replacement],
      },
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
      sessionPayload: {
        ...createTestSessionRequiredFields(),
        sessionId: "replace",
        aggregateVersion: 0,
        messages: [first, updatedReplacement],
      },
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
      ts: TEST_MESSAGE_TS,
      role: "assistant",
      presentationMessageId: "pm_fx11",
      content: "partial",
      dialogProcessId: "d-stop",
      turnScopeId: "t-stop",
    };
    await writeSessionArtifact({
      sessionDir: root,
      sessionPayload: {
        ...createTestSessionRequiredFields(),
        sessionId: "continue",
        aggregateVersion: 0,
        messages: [stopped],
      },
    });
    const continuation = {
      messageUid: "continued",
      ts: TEST_MESSAGE_TS,
      role: "assistant",
      presentationMessageId: "pm_fx12",
      content: "complete",
      dialogProcessId: "d-next",
      turnScopeId: "t-next",
    };
    await writeSessionArtifact({
      sessionDir: root,
      sessionPayload: {
        ...createTestSessionRequiredFields(),
        sessionId: "continue",
        aggregateVersion: 0,
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
        ...createTestSessionRequiredFields(),
        sessionId: "broken",
        aggregateVersion: 0,
        messages: [{ role: "user", messageOrigin: "natural", content: "x", turnScopeId: "x" }],
      },
    });
    const manifest = JSON.parse(await readFile(files.session, "utf8"));
    const turnFile = path.join(root, manifest.turnOrder[0].file);
    await rm(turnFile, { force: true });
    await assert.rejects(readSessionArtifact({ sessionDir: root }), {
      code: "SESSION_TURN_ARTIFACT_MISSING",
    });
    const committedBytes = manifest.turnOrder[0].committedBytes;
    await writeFile(turnFile, "{broken", "utf8");
    await assert.rejects(readSessionArtifact({ sessionDir: root }), {
      code: "TURN_JOURNAL_TRUNCATED",
    });
    await writeFile(turnFile, "{".padEnd(committedBytes, "x"), "utf8");
    await assert.rejects(readSessionArtifact({ sessionDir: root }), {
      code: "ARTIFACT_JSON_CORRUPTED",
    });
  }));

test("session reader rejects order references to messages that were never committed", async () =>
  withTemp(async (root) => {
    const files = buildSessionArtifactFileMap(root);
    await writeSessionArtifact({
      sessionDir: root,
      sessionPayload: {
        ...createTestSessionRequiredFields(),
        sessionId: "order-gap",
        aggregateVersion: 0,
        messages: [{ role: "user", messageOrigin: "natural", content: "x", turnScopeId: "x" }],
      },
    });
    const original = JSON.parse(await readFile(files.session, "utf8"));
    const withTurnGap = structuredClone(original);
    withTurnGap.turnOrder[0].messageOrder.push("sm_never_committed");
    await writeFile(files.session, JSON.stringify(withTurnGap), "utf8");
    await assert.rejects(readSessionArtifact({ sessionDir: root }), {
      code: SESSION_ERROR_CODE.TURN_JOURNAL_MESSAGE_MISSING,
    });
    const withSessionGap = structuredClone(original);
    withSessionGap.messageOrder.push({ messageUid: "sm_never_committed" });
    await writeFile(files.session, JSON.stringify(withSessionGap), "utf8");
    await assert.rejects(readSessionArtifact({ sessionDir: root }), {
      code: SESSION_ERROR_CODE.MESSAGE_ORDER_MESSAGE_MISSING,
    });
  }));

test("inspect is read-only, repair is idempotent, and cleanup honors dry-run and isolation", async () =>
  withTemp(async (root) => {
    const sessionDir = path.join(root, "session-a");
    await writeSessionArtifact({
      sessionDir,
      sessionPayload: {
        ...createTestSessionRequiredFields(),
        sessionId: "a",
        aggregateVersion: 0,
        messages: [{ role: "user", messageOrigin: "natural", content: "x" }],
      },
    });
    const files = buildSessionArtifactFileMap(sessionDir);
    await appendRollingJsonlArtifactLog({ sessionDir, log: { id: 1, dialogProcessId: TEST_TURN } });
    const indexPath = path.join(turnDirOf(sessionDir, TEST_TURN), "index.json");
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
    const firstRepair = await repairSessionArtifacts({
      sessionDir,
      assertSessionWritable: allowSessionWrite,
    });
    assert.deepEqual(firstRepair.repaired, [`turns/${TEST_TURN}/segment-000001.jsonl`]);
    assert.deepEqual(
      (await repairSessionArtifacts({ sessionDir, assertSessionWritable: allowSessionWrite }))
        .repaired,
      [],
    );
    const dry = await cleanupSessionArtifacts({
      sessionDir,
      assertSessionWritable: allowSessionWrite,
    });
    assert.equal(dry.dryRun, true);
    await access(orphan);
    await access(temp);
    await access(staging);
    const cleaned = await cleanupSessionArtifacts({
      sessionDir,
      dryRun: false,
      assertSessionWritable: allowSessionWrite,
    });
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
        ...createTestSessionRequiredFields(),
        sessionId: "deleted-session",
        aggregateVersion: 0,
        messages: [
          { role: "user", messageOrigin: "natural", content: "legacy", turnScopeId: "one" },
        ],
      }),
      "utf8",
    );
    const assertDeleted = async () => {
      throw createSessionDeletedError({ sessionId: "deleted-session", operation: "test" });
    };

    await appendRollingJsonlArtifactLog({ sessionDir, log: { id: 2, dialogProcessId: TEST_TURN } });
    const indexPath = path.join(turnDirOf(sessionDir, TEST_TURN), "index.json");
    const indexBefore = await readFile(indexPath, "utf8");
    await assert.rejects(
      repairSessionArtifacts({
        sessionDir,
        sessionId: "deleted-session",
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
        assertSessionWritable: assertDeleted,
      }),
      { code: "SESSION_DELETED" },
    );
    await access(temp);
  }));
