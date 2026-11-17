/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import { SESSION_ERROR_CODE } from "@noobot/session-protocol";
import { buildSessionArtifactFileMap } from "../../src/session/session-artifact-files.js";
import {
  readCheckpointReceiptReferences,
  buildStoredCheckpointReceipts,
} from "../../src/session/session-artifact-session/checkpoint-receipts.js";
import {
  withSessionStorageTransaction,
  observeSessionStorageWork,
  invalidateArtifactRead,
} from "../../src/session/session-artifact-session/storage-transaction.js";
import { TEST_STORAGE_SERVICE as storageService } from "../helpers/storage-service.js";
import { withTemp, writeSessionArtifact } from "./session-artifact-store-v2.test-helpers.js";

async function createFixture(sessionDir) {
  await writeSessionArtifact({
    sessionDir,
    sessionPayload: {
      sessionId: "transaction-receipts",
      aggregateVersion: 0,
      messages: [
        {
          role: "user",
          messageOrigin: "natural",
          messageUid: "m1",
          turnScopeId: "active",
          dialogProcessId: "active",
          content: "question",
          summarized: true,
        },
      ],
      turnSummaryCheckpoints: {
        active: {
          dialogProcessId: "active",
          turnScopeId: "active",
          checkpointRevision: 1,
          receipts: [
            {
              checkpointId: "c1",
              checkpointRevision: 1,
              requestHash: "sha256:fixture",
              persistedMessageUids: ["m1"],
              summarizedMessageUids: ["m1"],
              retainedMessageUids: [],
              markedCount: 1,
              committedAt: "2026-01-01T00:00:00.000Z",
            },
          ],
        },
      },
    },
  });
  return JSON.parse(await readFile(buildSessionArtifactFileMap(sessionDir).session, "utf8"));
}

test("a new turn without checkpoints shares the verified source inside one transaction", async () =>
  withTemp(async (sessionDir) => {
    const session = await createFixture(sessionDir);
    const observed = await observeSessionStorageWork(() =>
      withSessionStorageTransaction(sessionDir, async () => {
        const original = await readCheckpointReceiptReferences({
          storageService,
          sessionDir,
          session,
        });
        const extended = structuredClone(session);
        extended.turnOrder.push({
          ...extended.turnOrder[0],
          turnId: "turn-000002",
          turnScopeId: "next",
          dialogProcessId: "next",
          summarySnapshots: [],
        });
        const options = { storageService, sessionDir, session: extended };
        const projected = await readCheckpointReceiptReferences(options);
        assert.deepEqual(projected.turnSummaryCheckpoints, original.turnSummaryCheckpoints);
        const stored = await buildStoredCheckpointReceipts(options);
        assert.deepEqual(stored.turnSummaryCheckpoints, session.turnSummaryCheckpoints);
        assert.equal(projected.turnOrder.length, 2);
      }),
    );
    assert.equal(observed.work.checkpointIdentityVerifications, 1);
    assert.equal(observed.work.checkpointIdentityCollections, 1);
    assert.equal(observed.work.checkpointIdentityVisits, 1);
    assert.equal(observed.work.checkpointIdentitySourceReuses, 2);
    const next = await observeSessionStorageWork(() =>
      withSessionStorageTransaction(sessionDir, () =>
        readCheckpointReceiptReferences({ storageService, sessionDir, session }),
      ),
    );
    assert.equal(
      next.work.checkpointIdentityVerifications,
      1,
      "a later transaction still revalidates history",
    );
  }));

for (const [name, change] of Object.entries({
  session: (session) => {
    session.sessionId = "another-session";
  },
  turn: (session) => {
    session.turnOrder[0].turnId = "another-turn";
  },
  scope: (session) => {
    session.turnOrder[0].turnScopeId = "another-scope";
  },
  owner: (session) => {
    session.turnOrder[0].dialogProcessId = "another-owner";
  },
  checkpoint: (session) => {
    session.turnOrder[0].summarySnapshots[0].checkpointId = "another-checkpoint";
  },
  committedAt: (session) => {
    session.turnOrder[0].summarySnapshots[0].committedAt = "2026-01-02T00:00:00.000Z";
  },
  receiptOwner: (session) => {
    session.turnSummaryCheckpoints.active.dialogProcessId = "another-owner";
  },
}))
  test(`transaction identity reuse rejects a changed ${name}`, async () =>
    withTemp(async (sessionDir) => {
      const session = await createFixture(sessionDir);
      const observed = await observeSessionStorageWork(() =>
        withSessionStorageTransaction(sessionDir, async () => {
          await readCheckpointReceiptReferences({ storageService, sessionDir, session });
          const changed = structuredClone(session);
          change(changed);
          const code =
            name === "checkpoint"
              ? SESSION_ERROR_CODE.SUMMARY_SNAPSHOT_INDEX_MISMATCH
              : SESSION_ERROR_CODE.SUMMARY_CHECKPOINT_IDENTITY_INVALID;
          await assert.rejects(
            readCheckpointReceiptReferences({ storageService, sessionDir, session: changed }),
            { code },
          );
          await readCheckpointReceiptReferences({ storageService, sessionDir, session });
        }),
      );
      assert.equal(observed.work.checkpointIdentityCollections, 1);
    }));

test("snapshot removal and explicit invalidation cannot reuse a stale identity source", async () =>
  withTemp(async (sessionDir) => {
    const session = await createFixture(sessionDir);
    const observed = await observeSessionStorageWork(() =>
      withSessionStorageTransaction(sessionDir, async () => {
        await readCheckpointReceiptReferences({ storageService, sessionDir, session });
        const removed = structuredClone(session);
        removed.turnOrder[0].summarySnapshots = [];
        await assert.rejects(
          readCheckpointReceiptReferences({ storageService, sessionDir, session: removed }),
          { code: SESSION_ERROR_CODE.SUMMARY_CHECKPOINT_IDENTITY_INVALID },
        );
        const file = `${sessionDir}/${session.turnOrder[0].summarySnapshots[0].file}`;
        invalidateArtifactRead(file);
        await readCheckpointReceiptReferences({ storageService, sessionDir, session });
      }),
    );
    assert.equal(observed.work.checkpointIdentityVerifications, 2);
  }));

test("receipt metadata edits never reuse a stale stored projection", async () =>
  withTemp(async (sessionDir) => {
    const session = await createFixture(sessionDir);
    await withSessionStorageTransaction(sessionDir, async () => {
      const options = { storageService, sessionDir, session };
      const first = await buildStoredCheckpointReceipts(options);
      const second = await buildStoredCheckpointReceipts(options);
      assert.equal(
        first.turnSummaryCheckpoints.active.receipts[0],
        second.turnSummaryCheckpoints.active.receipts[0],
      );
      session.turnSummaryCheckpoints.active.receipts[0].requestHash = "changed";
      const changed = await buildStoredCheckpointReceipts(options);
      assert.equal(changed.turnSummaryCheckpoints.active.receipts[0].requestHash, "changed");
      assert.equal(first.turnSummaryCheckpoints.active.receipts[0].requestHash, "sha256:fixture");
    });
  }));

test("source reuse still detects snapshot damage after explicit invalidation", async () =>
  withTemp(async (sessionDir) => {
    const session = await createFixture(sessionDir);
    await withSessionStorageTransaction(sessionDir, async () => {
      const options = { storageService, sessionDir, session };
      await readCheckpointReceiptReferences(options);
      const file = `${sessionDir}/${session.turnOrder[0].summarySnapshots[0].file}`;
      const snapshot = JSON.parse(await readFile(file, "utf8"));
      snapshot.persistedMessageUids.push("unexpected");
      await writeFile(file, JSON.stringify(snapshot));
      invalidateArtifactRead(file);
      await assert.rejects(buildStoredCheckpointReceipts(options), {
        code: SESSION_ERROR_CODE.SUMMARY_SNAPSHOT_HASH_MISMATCH,
      });
    });
  }));
