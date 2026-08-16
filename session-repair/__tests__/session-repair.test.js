/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { validateTransferEnvelope } from "@noobot/semantic-transfer-protocol";
import {
  migrateSessionDocument,
  readSessionForProtocolRepair,
  reconcileCompletedTurnSummaryMarks,
  reconcileExecutionSegmentIndex,
  reconcileSessionSummaryIndex,
  reconcileUncommittedAggregateConflictContinuations,
  resegmentMigratedCheckpointBaselines,
  runAtomicSessionRepair,
} from "../src/index.js";

function aggregateConflictContinuationSession({ withCommittedMessage = false } = {}) {
  const sourceTurn = {
    turnScopeId: "turn-stopped",
    dialogProcessId: "dialog-stopped",
    state: "stop_completed",
    executionState: "user_stopped",
    continuedByTurnScopeId: "turn-failed-continue",
  };
  const failedTurn = {
    turnScopeId: "turn-failed-continue",
    dialogProcessId: "dialog-continue",
    action: "continue",
    state: "action_failed",
    phase: "action",
    executionState: "error",
    failure: {
      code: "SESSION_AGGREGATE_VERSION_CONFLICT",
      message: "session aggregate version conflict",
    },
    continuationSource: {
      turnScopeId: sourceTurn.turnScopeId,
      dialogProcessId: sourceTurn.dialogProcessId,
    },
  };
  return {
    aggregateVersion: 3,
    activeTurnScopeId: "",
    messages: [
      { messageUid: "existing", turnScopeId: "unrelated-turn", content: "preserved" },
      ...(withCommittedMessage
        ? [{ messageUid: "committed", turnScopeId: failedTurn.turnScopeId, role: "user" }]
        : []),
    ],
    turnLifecycle: {
      sequence: 14,
      turns: {
        "unrelated-turn": { turnScopeId: "unrelated-turn", state: "completed" },
        [sourceTurn.turnScopeId]: sourceTurn,
        [failedTurn.turnScopeId]: failedTurn,
      },
      commandReceipts: [
        { turnScopeId: "unrelated-turn", sequence: 1 },
        { turnScopeId: failedTurn.turnScopeId, sequence: 13 },
        { turnScopeId: failedTurn.turnScopeId, sequence: 14 },
      ],
    },
    authorityEventOutbox: [
      { eventId: "unrelated", envelope: { turnScopeId: "unrelated-turn" } },
      { eventId: "accepted", envelope: { turnScopeId: failedTurn.turnScopeId } },
      { eventId: "failed", envelope: { turnScopeId: failedTurn.turnScopeId } },
    ],
  };
}

function legacyMessage() {
  return {
    messageUid: "sm-1",
    messageId: "message-1",
    role: "assistant",
    turnScopeId: "turn-1",
    dialogProcessId: "dialog-1",
    transferEnvelopes: [
      {
        protocol: "noobot.semantic-transfer",
        version: 1,
        direction: "output",
        transport: "file",
        files: [
          {
            attachmentId: "attachment-1",
            sessionId: "session-1",
            attachmentSource: "model",
            name: "result.md",
            mimeType: "text/markdown",
            size: 12,
            relativePath: "runtime/attach/result.md",
            path: "/host/result.md",
          },
        ],
      },
    ],
  };
}

test("migrates Semantic Transfer V1 into the one strict V2 envelope", () => {
  const result = migrateSessionDocument({ sessionId: "session-1", messages: [legacyMessage()] });
  assert.equal(result.changed, true);
  const envelope = result.document.messages[0].transferEnvelopes[0];
  assert.equal(envelope.version, 2);
  assert.equal(validateTransferEnvelope(envelope, { strict: true }).ok, true);
  assert.deepEqual(envelope.payload.attachments[0].identity, {
    attachmentId: "attachment-1",
    sessionId: "session-1",
    attachmentSource: "model",
  });
  assert.equal(JSON.stringify(envelope).includes("relativePath"), false);
  assert.equal(JSON.stringify(envelope).includes("/host/result.md"), false);
});

test("migrates nested workflow transfer collections with attachmentMeta V1 records", () => {
  const message = legacyMessage();
  message.pluginMeta = {
    payload: {
      nodeResultTransferEnvelopes: [
        {
          protocol: "noobot.semantic-transfer",
          version: 1,
          direction: "output",
          transport: "file",
          files: [
            {
              filePath: "/workspace/result.md",
              attachmentMeta: {
                attachmentId: "nested-attachment",
                sessionId: "session-1",
                attachmentSource: "model",
                name: "nested.md",
                mimeType: "text/markdown",
              },
            },
          ],
        },
      ],
    },
  };
  const result = migrateSessionDocument({ sessionId: "session-1", messages: [message] });
  const envelope = result.document.messages[0].pluginMeta.payload.nodeResultTransferEnvelopes[0];
  assert.equal(validateTransferEnvelope(envelope, { strict: true }).ok, true);
  assert.equal(envelope.payload.attachments[0].identity.attachmentId, "nested-attachment");
  assert.equal(JSON.stringify(envelope).includes("filePath"), false);
});

test("rejects a legacy transfer that cannot recover canonical Turn identity", () => {
  const message = legacyMessage();
  delete message.turnScopeId;
  assert.throws(
    () => migrateSessionDocument({ sessionId: "session-1", messages: [message] }),
    (error) => error.code === "SESSION_TRANSFER_V1_IDENTITY_REQUIRED",
  );
});

test("reconciles execution index metadata through one repair function", () => {
  const result = reconcileExecutionSegmentIndex(
    { segments: [{ file: "segment-1.jsonl", bytes: 1, records: 1 }] },
    [{ file: "segment-1.jsonl", bytes: 20, records: 2 }],
  );
  assert.deepEqual(result.repaired, ["segment-1.jsonl"]);
  assert.deepEqual(result.index.segments[0], { file: "segment-1.jsonl", bytes: 20, records: 2 });
});

test("reconciles session summary membership from materialized artifact ids", () => {
  const result = reconcileSessionSummaryIndex({
    sessionIds: ["a", "b"],
    sessions: [{ sessionId: "a" }, { sessionId: "a" }, { sessionId: "orphan" }],
  });
  assert.deepEqual(
    result.sessions.map((item) => item.sessionId),
    ["a"],
  );
  assert.equal(result.changed, true);
});

test("migrates duplicate terminal and command facts into the canonical lifecycle", () => {
  const terminalStatus = {
    turnScopeId: "turn-1",
    dialogProcessId: "dialog-1",
    status: "completed",
    reason: "run_completed",
  };
  const result = migrateSessionDocument({
    sessionId: "session-1",
    aggregateVersion: 3,
    messages: [
      {
        messageUid: "user-1",
        role: "user",
        content: "hello",
        sessionId: "session-1",
        turnScopeId: "turn-1",
        dialogProcessId: "dialog-1",
        ts: "2026-01-01T00:00:00.000Z",
        turnCommit: { action: "send", commandId: "send-1", runState: "pending_start" },
      },
    ],
    turnStatuses: [terminalStatus],
    mutationReceipts: [
      {
        operation: "delete_from",
        commandId: "delete-1",
        requestHash: "legacy-delete-hash",
        aggregateVersion: 3,
        result: { deletedCount: 1 },
        committedAt: "2026-01-01T00:00:03.000Z",
      },
    ],
    turnLifecycle: {
      turns: {
        "turn-1": {
          turnScopeId: "turn-1",
          dialogProcessId: "dialog-1",
          commandId: "send-1:completed",
          completionCommitId: "send-1:completed",
          terminalStatus,
        },
      },
      commandReceipts: [
        {
          commandId: "send-1:completed",
          eventType: "turn.completed",
          turnScopeId: "turn-1",
          requestHash: "lifecycle-hash",
          envelope: {
            commandId: "send-1:completed",
            eventType: "turn.completed",
            phase: "completion",
          },
        },
      ],
    },
    authorityEventOutbox: [
      {
        eventId: "event-1",
        envelope: { commandId: "send-1:completed", eventType: "turn.completed" },
      },
    ],
  });

  assert.equal(result.changed, true);
  assert.equal(Object.hasOwn(result.document, "turnStatuses"), false);
  assert.equal(Object.hasOwn(result.document, "mutationReceipts"), false);
  assert.deepEqual(
    result.document.turnLifecycle.commandReceipts.map(({ commandId, type }) => ({
      commandId,
      type,
    })),
    [
      { commandId: "send-1:completed:turn.completed", type: "turn.completed" },
      { commandId: "send-1", type: "session.turn.commit" },
      { commandId: "delete-1", type: "session.message.delete_from" },
    ],
  );
  assert.equal(
    result.document.turnLifecycle.turns["turn-1"].completionCommitId,
    "send-1:completed:turn.completed",
  );
  assert.equal(
    result.document.authorityEventOutbox[0].envelope.commandId,
    "send-1:completed:turn.completed",
  );
});

test("rejects conflicting duplicate terminal facts during explicit migration", () => {
  assert.throws(
    () =>
      migrateSessionDocument({
        sessionId: "session-1",
        turnStatuses: [
          {
            turnScopeId: "turn-1",
            dialogProcessId: "dialog-1",
            status: "error",
            reason: "run_error",
          },
        ],
        turnLifecycle: {
          turns: {
            "turn-1": {
              turnScopeId: "turn-1",
              dialogProcessId: "dialog-1",
              terminalStatus: {
                turnScopeId: "turn-1",
                dialogProcessId: "dialog-1",
                status: "completed",
                reason: "run_completed",
              },
            },
          },
        },
      }),
    (error) => error.code === "SESSION_TERMINAL_FACT_CONFLICT",
  );
});

test("repairs eligible messages in completed turns without marking preserved user or final messages", () => {
  const result = reconcileCompletedTurnSummaryMarks({
    turnLifecycle: {
      turns: {
        "turn-1": {
          dialogProcessId: "dialog-1",
          turnScopeId: "turn-1",
          terminalStatus: { status: "completed", reason: "run_completed" },
        },
      },
    },
    messages: [
      {
        messageUid: "user-1",
        role: "user",
        dialogProcessId: "dialog-1",
        turnScopeId: "turn-1",
        summarized: false,
      },
      {
        messageUid: "tool-call-1",
        role: "assistant",
        dialogProcessId: "dialog-1",
        turnScopeId: "turn-1",
        tool_calls: [{ id: "call-1", name: "read_file" }],
        summarized: false,
      },
      {
        messageUid: "tool-result-1",
        role: "tool",
        dialogProcessId: "dialog-1",
        turnScopeId: "turn-1",
        tool_call_id: "call-1",
        toolName: "read_file",
        summarized: false,
      },
      {
        messageUid: "final-1",
        role: "assistant",
        dialogProcessId: "dialog-1",
        turnScopeId: "turn-1",
        content: "done",
        summarized: false,
      },
    ],
  });
  assert.equal(result.changed, true);
  assert.deepEqual(
    result.document.messages.map((message) => message.summarized),
    [false, true, true, false],
  );
  assert.deepEqual(result.repaired, ["turn-1"]);
});

test("removes an uncommitted aggregate-conflict continuation as one lifecycle repair", () => {
  const source = aggregateConflictContinuationSession();
  const result = reconcileUncommittedAggregateConflictContinuations(source);
  assert.equal(result.changed, true);
  assert.deepEqual(result.repaired, ["turn-failed-continue"]);
  assert.deepEqual(Object.keys(result.document.turnLifecycle.turns), [
    "unrelated-turn",
    "turn-stopped",
  ]);
  assert.equal(result.document.turnLifecycle.turns["turn-stopped"].continuedByTurnScopeId, "");
  assert.deepEqual(result.document.turnLifecycle.commandReceipts, [
    { turnScopeId: "unrelated-turn", sequence: 1 },
  ]);
  assert.deepEqual(result.document.authorityEventOutbox, [
    { eventId: "unrelated", envelope: { turnScopeId: "unrelated-turn" } },
  ]);
  assert.equal(result.document.aggregateVersion, 3);
  assert.equal(result.document.turnLifecycle.sequence, 14);
  assert.deepEqual(result.document.messages, source.messages);
  assert.deepEqual(reconcileUncommittedAggregateConflictContinuations(result.document), {
    document: result.document,
    changed: false,
    repaired: [],
  });
});

test("refuses to remove an aggregate-conflict continuation that committed a message", () => {
  const source = aggregateConflictContinuationSession({ withCommittedMessage: true });
  const result = reconcileUncommittedAggregateConflictContinuations(source);
  assert.equal(result.changed, false);
  assert.deepEqual(result.repaired, []);
  assert.deepEqual(result.document, source);
});

test("atomic repair leaves the authoritative directory unchanged when validation fails", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "noobot-session-repair-"));
  const sessionDir = path.join(root, "session-1");
  await mkdir(sessionDir);
  await writeFile(path.join(sessionDir, "session.json"), "original", "utf8");
  try {
    await assert.rejects(
      runAtomicSessionRepair({
        sessionDir,
        repair: async (stagingDir) =>
          writeFile(path.join(stagingDir, "session.json"), "changed", "utf8"),
        validate: async () => {
          throw new Error("invalid");
        },
      }),
    );
    assert.equal(await readFile(path.join(sessionDir, "session.json"), "utf8"), "original");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("protocol repair materializes a cumulative checkpoint only inside the repair project", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "noobot-session-repair-journal-"));
  const turnsDir = path.join(root, "turns");
  const snapshotsDir = path.join(root, "turn-snapshots", "turn-000001");
  await Promise.all([
    mkdir(turnsDir, { recursive: true }),
    mkdir(snapshotsDir, { recursive: true }),
  ]);
  const messages = [
    { messageUid: "m1", role: "user", content: "one" },
    { messageUid: "m2", role: "assistant", content: "two" },
  ];
  const snapshot = {
    schemaVersion: 1,
    checkpointId: "checkpoint-1",
    checkpointRevision: 1,
    messages,
  };
  const snapshotFile = "turn-snapshots/turn-000001/checkpoint-000001.json";
  const contentHash = `sha256:${createHash("sha256").update(JSON.stringify(snapshot)).digest("hex")}`;
  const journal = `${JSON.stringify({
    op: "summary_snapshot",
    checkpointId: snapshot.checkpointId,
    checkpointRevision: snapshot.checkpointRevision,
    file: snapshotFile,
    contentHash,
  })}\n`;
  await Promise.all([
    writeFile(path.join(root, snapshotFile), JSON.stringify(snapshot), "utf8"),
    writeFile(path.join(turnsDir, "turn-000001.jsonl"), journal, "utf8"),
  ]);
  try {
    const repaired = await readSessionForProtocolRepair({
      sessionDir: root,
      session: {
        schemaVersion: 5,
        turnOrder: [
          {
            turnId: "turn-000001",
            file: "turns/turn-000001.jsonl",
            committedBytes: Buffer.byteLength(journal),
            messageOrder: ["m1", "m2"],
          },
        ],
        messageOrder: [{ messageUid: "m1" }, { messageUid: "m2" }],
      },
    });
    assert.deepEqual(repaired.messages, messages);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("protocol repair resegments a migrated checkpoint baseline and preserves the active tail", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "noobot-session-resegment-"));
  const turnsDir = path.join(root, "turns");
  const snapshotsDir = path.join(root, "turn-snapshots", "turn-000001");
  await Promise.all([
    mkdir(turnsDir, { recursive: true }),
    mkdir(snapshotsDir, { recursive: true }),
  ]);
  const record = (messageUid, ts) => {
    const message = { messageUid, role: "assistant", content: messageUid, ts };
    return {
      op: "upsert",
      messageUid,
      message,
      hash: `sha256:${createHash("sha256").update(JSON.stringify(message)).digest("hex")}`,
    };
  };
  const records = [
    record("m1", "2026-01-01T00:00:30.000Z"),
    record("m2", "2026-01-01T00:01:30.000Z"),
    record("m3", "2026-01-01T00:02:30.000Z"),
  ];
  const checkpointPayloads = [
    {
      schemaVersion: 2,
      checkpointId: "checkpoint-1",
      checkpointRevision: 1,
      committedAt: "2026-01-01T00:01:00.000Z",
      previousCheckpointHash: "",
      records,
    },
    {
      schemaVersion: 2,
      checkpointId: "checkpoint-2",
      checkpointRevision: 2,
      committedAt: "2026-01-01T00:02:00.000Z",
      previousCheckpointHash: "",
      records: [],
    },
  ];
  const indexes = [];
  let previousHash = "";
  for (let index = 0; index < checkpointPayloads.length; index += 1) {
    const payload = { ...checkpointPayloads[index], previousCheckpointHash: previousHash };
    const contentHash = `sha256:${createHash("sha256").update(JSON.stringify(payload)).digest("hex")}`;
    const file = `turn-snapshots/turn-000001/checkpoint-${String(index + 1).padStart(6, "0")}.json`;
    await writeFile(path.join(root, file), JSON.stringify(payload), "utf8");
    indexes.push({
      op: "summary_snapshot",
      checkpointId: payload.checkpointId,
      checkpointRevision: payload.checkpointRevision,
      file,
      contentHash,
    });
    previousHash = contentHash;
  }
  const journalFile = path.join(turnsDir, "turn-000001.jsonl");
  const journal = indexes.map((index) => `${JSON.stringify(index)}\n`).join("");
  await Promise.all([
    writeFile(journalFile, journal, "utf8"),
    writeFile(
      path.join(root, "session.json"),
      JSON.stringify({
        schemaVersion: 6,
        turnOrder: [
          {
            turnId: "turn-000001",
            file: "turns/turn-000001.jsonl",
            committedBytes: Buffer.byteLength(journal),
            recordCount: indexes.length,
          },
        ],
      }),
      "utf8",
    ),
  ]);
  try {
    const repaired = await resegmentMigratedCheckpointBaselines({ sessionDir: root });
    assert.deepEqual(repaired, [
      { turnId: "turn-000001", checkpointRecordCounts: [1, 1], tailRecordCount: 1 },
    ]);
    const nextJournal = (await readFile(journalFile, "utf8")).trim().split("\n").map(JSON.parse);
    assert.deepEqual(
      nextJournal.map((entry) => entry.op),
      ["summary_snapshot", "summary_snapshot", "upsert"],
    );
    assert.equal(nextJournal[2].messageUid, "m3");
    const first = JSON.parse(await readFile(path.join(root, nextJournal[0].file), "utf8"));
    const second = JSON.parse(await readFile(path.join(root, nextJournal[1].file), "utf8"));
    assert.deepEqual(
      first.records.map((entry) => entry.messageUid),
      ["m1"],
    );
    assert.deepEqual(
      second.records.map((entry) => entry.messageUid),
      ["m2"],
    );
    assert.equal(second.previousCheckpointHash, nextJournal[0].contentHash);
    assert.equal(
      `sha256:${createHash("sha256").update(JSON.stringify(second)).digest("hex")}`,
      nextJournal[1].contentHash,
    );
    assert.deepEqual(await resegmentMigratedCheckpointBaselines({ sessionDir: root }), []);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
