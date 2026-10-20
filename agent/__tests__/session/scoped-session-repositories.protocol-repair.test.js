/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import path from "node:path";
import { readFile, writeFile } from "node:fs/promises";
import {
  buildSessionArtifactFileMap,
  readSessionArtifact,
} from "../../src/session/session-artifact-store.js";
import {
  applySessionMessageFacts,
  createTestSessionRequiredFields,
} from "../helpers/session-message-facts.js";
import { SESSION_ARTIFACT_SCHEMA_VERSION } from "@noobot/session-protocol";
import {
  buildHarness,
  readJson,
  readJournalLines,
} from "./scoped-session-repositories.fixtures.js";

const treeContext = (sessionRepo, sessionId) => ({
  persistenceContext: sessionRepo.treePersistenceContext("alice", sessionId),
});

test("protocol repair moves v10 journal snapshot indexes into the manifest", async () => {
  const harness = buildHarness();
  const { sessionRepo } = await harness.setup();
  try {
    const sessionId = "v10-journal-snapshot-index";
    const message = (messageUid, ts) => ({
      messageUid,
      role: messageUid === "m1" ? "user" : "assistant",
      content: messageUid,
      dialogProcessId: "dialog-active",
      turnScopeId: "active",
      ts,
    });
    const receipt = {
      checkpointId: "checkpoint-1",
      checkpointRevision: 1,
      requestHash: "sha256:fixture",
      persistedMessageUids: ["m1", "m2"],
      summarizedMessageUids: ["m1"],
      committedAt: "2026-01-01T00:01:00.000Z",
    };
    await sessionRepo.save(
      "alice",
      applySessionMessageFacts({
        ...createTestSessionRequiredFields(),
        parentSessionId: "",
        sessionId,
        aggregateVersion: 0,
        messages: [
          message("m1", "2026-01-01T00:00:00.000Z"),
          message("m2", "2026-01-01T00:00:30.000Z"),
        ],
        turnSummaryCheckpoints: {
          active: { dialogProcessId: "dialog-active", turnScopeId: "active", receipts: [receipt] },
        },
      }),
      { createOnly: true, ...treeContext(sessionRepo, sessionId) },
    );
    const scope = await sessionRepo.requireSessionScope(
      "alice",
      sessionId,
      treeContext(sessionRepo, sessionId).persistenceContext,
    );
    const files = buildSessionArtifactFileMap(scope.sessionDir);
    const current = await readJson(files.session);
    const [turn] = current.turnOrder;
    const journalFile = path.join(scope.sessionDir, turn.file);

    const tail = message("m3", "2026-01-01T00:02:00.000Z");
    const v10Journal = [
      ...turn.summarySnapshots.map((index) => ({
        op: "summary_snapshot",
        ...index,
        turnScopeId: turn.turnScopeId,
        dialogProcessId: turn.dialogProcessId,
      })),
      {
        op: "upsert",
        messageUid: tail.messageUid,
        message: tail,
        hash: `sha256:${createHash("sha256").update(JSON.stringify(tail)).digest("hex")}`,
      },
    ];
    const journalText = v10Journal.map((record) => `${JSON.stringify(record)}\n`).join("");
    const { summarySnapshots, ...v10Turn } = turn;
    await writeFile(journalFile, journalText, "utf8");
    await writeFile(
      files.session,
      JSON.stringify({
        ...current,
        schemaVersion: 10,
        messageOrder: [...current.messageOrder, { messageUid: "m3" }],
        turnOrder: [
          {
            ...v10Turn,
            committedBytes: Buffer.byteLength(journalText),
            recordCount: v10Journal.length,
            messageCount: 3,
            messageOrder: ["m1", "m2", "m3"],
          },
        ],
      }),
      "utf8",
    );

    await sessionRepo.repairSessionProtocol(
      "alice",
      sessionId,
      treeContext(sessionRepo, sessionId),
    );

    const migrated = await readJson(files.session);
    assert.equal(migrated.schemaVersion, SESSION_ARTIFACT_SCHEMA_VERSION);
    const withoutContentHash = ({ contentHash, ...index }) => index;
    assert.deepEqual(
      migrated.turnOrder[0].summarySnapshots.map(withoutContentHash),
      summarySnapshots.map(withoutContentHash),
    );
    const migratedJournal = readJournalLines(await readFile(journalFile, "utf8"));
    assert.equal(
      migratedJournal.some((record) => record.op === "summary_snapshot"),
      false,
    );
    const restored = await readSessionArtifact({ sessionDir: scope.sessionDir });
    assert.deepEqual(
      restored.messages.map((entry) => entry.messageUid),
      ["m1", "m2", "m3"],
    );
  } finally {
    await harness.cleanup();
  }
});

test("concurrent repository saves allocate monotonic Turn journals without cross-Turn records", async () => {
  const harness = buildHarness();
  const { sessionRepo } = await harness.setup();
  try {
    const sessionId = "concurrent-turn-journals";
    const keep = {
      messageUid: "keep-message",
      role: "user",
      content: "keep",
      dialogProcessId: "dialog-keep",
      turnScopeId: "turn-keep",
    };
    const replaced = {
      messageUid: "replaced-message",
      role: "assistant",
      content: "replaced",
      dialogProcessId: "dialog-replaced",
      turnScopeId: "turn-replaced",
    };
    await sessionRepo.save(
      "alice",
      applySessionMessageFacts({
        ...createTestSessionRequiredFields(),
        parentSessionId: "",
        sessionId,
        aggregateVersion: 0,
        messages: [keep, replaced],
      }),
      { createOnly: true, ...treeContext(sessionRepo, sessionId) },
    );

    const replacement = (suffix) => ({
      messageUid: `replacement-${suffix}`,
      role: "assistant",
      content: `replacement-${suffix}`,
      dialogProcessId: `dialog-${suffix}`,
      turnScopeId: `turn-${suffix}`,
    });
    await Promise.all([
      sessionRepo.save(
        "alice",
        applySessionMessageFacts({
          ...createTestSessionRequiredFields(),
          parentSessionId: "",
          sessionId,
          aggregateVersion: 0,
          messages: [keep, replacement("a")],
        }),
        treeContext(sessionRepo, sessionId),
      ),
      sessionRepo.save(
        "alice",
        applySessionMessageFacts({
          ...createTestSessionRequiredFields(),
          parentSessionId: "",
          sessionId,
          aggregateVersion: 0,
          messages: [keep, replacement("b")],
        }),
        treeContext(sessionRepo, sessionId),
      ),
    ]);

    const scope = await sessionRepo.requireSessionScope(
      "alice",
      sessionId,
      treeContext(sessionRepo, sessionId).persistenceContext,
    );
    const files = buildSessionArtifactFileMap(scope.sessionDir);
    const manifest = await readJson(files.session);
    assert.deepEqual(
      manifest.turnOrder.map((turn) => turn.turnId),
      ["turn-000001", "turn-000004"],
    );
    assert.equal(manifest.turnArtifactSequence, 4);
    assert.equal(
      new Set(manifest.turnOrder.map((turn) => turn.turnId)).size,
      manifest.turnOrder.length,
    );

    const restored = await readSessionArtifact({ sessionDir: scope.sessionDir });
    assert.equal(restored.messages[0].turnScopeId, "turn-keep");
    assert.equal(restored.messages.length, 2);
    assert.equal(["turn-a", "turn-b"].includes(restored.messages[1].turnScopeId), true);

    for (const turn of manifest.turnOrder) {
      const records = (await readFile(path.join(scope.sessionDir, turn.file), "utf8"))
        .split("\n")
        .filter(Boolean)
        .map((line) => JSON.parse(line));
      const recordTurnScopes = new Set(
        records.map((record) => record?.message?.turnScopeId).filter(Boolean),
      );
      assert.deepEqual([...recordTurnScopes], [turn.turnScopeId]);
    }
  } finally {
    await harness.cleanup();
  }
});

test("session save rejects entity parentSessionId that conflicts with the located scope", async () => {
  const harness = buildHarness();
  const { sessionRepo } = await harness.setup();
  const childEntity = (parentSessionId) => ({
    ...createTestSessionRequiredFields(),
    sessionId: "child",
    parentSessionId,
    aggregateVersion: 0,
  });
  try {
    await sessionRepo.save(
      "alice",
      {
        ...createTestSessionRequiredFields(),
        sessionId: "p1",
        parentSessionId: "",
        aggregateVersion: 0,
      },
      { createOnly: true, ...treeContext(sessionRepo, "p1") },
    );
    await sessionRepo.save("alice", childEntity("p1"), {
      createOnly: true,
      ...treeContext(sessionRepo, "child"),
    });
    for (const conflictingParent of ["p2", ""]) {
      await assert.rejects(
        sessionRepo.save(
          "alice",
          childEntity(conflictingParent),
          treeContext(sessionRepo, "child"),
        ),
        { code: "SESSION_SCOPE_IDENTITY_CONFLICT", statusCode: 409 },
      );
    }
    const childScope = await sessionRepo.requireSessionScope(
      "alice",
      "child",
      treeContext(sessionRepo, "child").persistenceContext,
    );
    assert.equal(childScope.resolvedParentSessionId, "p1");
    assert.equal((await readJson(childScope.sessionFile)).parentSessionId, "p1");
  } finally {
    await harness.cleanup();
  }
});

test("protocol repair of an unregistered Session reports not found without recording a repair failure", async () => {
  const harness = buildHarness();
  const { sessionRepo } = await harness.setup();
  try {
    await assert.rejects(
      sessionRepo.repairSessionProtocol(
        "alice",
        "missing-session",
        treeContext(sessionRepo, "missing-session"),
      ),
      {
        code: "SESSION_NOT_FOUND",
        statusCode: 404,
      },
    );
    const lifecycle = await sessionRepo._readSessionLifecycleRecord("alice", "missing-session");
    assert.notEqual(lifecycle?.repair?.status, "failed");
  } finally {
    await harness.cleanup();
  }
});
