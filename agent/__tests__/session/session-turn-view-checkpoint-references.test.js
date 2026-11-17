/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFile, writeFile, rename, rm } from "node:fs/promises";
import path from "node:path";
import {
  readSessionArtifact,
  readSessionTurnView,
} from "../../src/session/session-artifact-session/session-artifact-reader.js";
import { TEST_STORAGE_SERVICE as storageService } from "../helpers/storage-service.js";
import { withTemp, writeSessionArtifact } from "./session-artifact-store-v2.test-helpers.js";
import { withProvisionedSessions } from "../helpers/provisioned-sessions.js";
import { commitTestSessionChanges } from "../helpers/session-services.js";
import { event } from "./turn-lifecycle-session-contract.test-helpers.js";
import { TURN_EVENT, TURN_PHASE } from "@noobot/session-protocol";

function receiptOf(session) {
  return session.turnSummaryCheckpoints.active.receipts[0];
}

async function seedCheckpoint(sessionDir) {
  await writeSessionArtifact({
    sessionDir,
    sessionPayload: {
      sessionId: "checkpoint-reference",
      aggregateVersion: 0,
      messages: [
        {
          role: "assistant",
          messageUid: "m1",
          presentationMessageId: "pm_active",
          turnScopeId: "active",
          dialogProcessId: "active",
          content: "checkpoint content",
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
              checkpointId: "checkpoint-1",
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
}

test("legacy turn reads borrow checkpoint UID lists while full reads own mutable copies", async () =>
  withTemp(async (sessionDir) => {
    await seedCheckpoint(sessionDir);
    const options = { storageService, sessionDir };
    const view = await readSessionTurnView({ ...options, turnScopeIds: ["active"] });
    const publicRead = await readSessionArtifact(options);
    assert.deepEqual(receiptOf(view.session), receiptOf(publicRead));
    for (const field of ["persistedMessageUids", "summarizedMessageUids"]) {
      assert.throws(() => receiptOf(view.session)[field].push("extra"), TypeError);
      receiptOf(publicRead)[field].push("public-only");
      assert.deepEqual(receiptOf(view.session)[field], ["m1"]);
    }
    const restored = await readSessionArtifact(options);
    assert.deepEqual(receiptOf(restored), receiptOf(view.session));
    receiptOf(restored).persistedMessageUids.push("mutable-after-rebuild");
    const next = await readSessionTurnView({ ...options, turnScopeIds: ["active"] });
    assert.deepEqual(receiptOf(next.session).persistedMessageUids, ["m1"]);
  }));

test("service mutations preserve unrelated checkpoints and public reads own their UID lists", async () => {
  await withProvisionedSessions({ userId: "u1", sessionIds: ["s1"] }, async ({ runtime }) => {
    const repo = runtime.repositories.sessionRepository;
    const persistenceContext = repo.treePersistenceContext("u1", "s1");
    await withTemp(async (sessionDir) => {
      await seedCheckpoint(sessionDir);
      const fixture = await readSessionArtifact({ storageService, sessionDir });
      await commitTestSessionChanges(runtime, {
        userId: "u1",
        sessionId: "s1",
        changes: {
          messages: fixture.messages.map((message) => ({
            ...message,
            sessionId: "s1",
            summarized: false,
          })),
          summaryCheckpoints: [
            {
              userId: "u1",
              sessionId: "s1",
              dialogProcessId: "active",
              turnScopeId: "active",
              checkpointId: "checkpoint-1",
              expectedCheckpointRevision: 0,
              persistedMessageUids: ["m1"],
              summarizedMessageUids: ["m1"],
              retainedMessageUids: [],
              messages: [],
            },
          ],
        },
      });
    });
    const service = runtime.sessionMessageService;
    const acceptance = {
      ...event(TURN_EVENT.ACTION_ACCEPTED, "accept-receipts", 0, {
        action: "send",
        phase: TURN_PHASE.ACTION,
      }),
      persistenceContext,
    };
    const accepted = await service.applyTurnLifecycleEvent(acceptance);
    assert.equal(accepted.applied, true);
    const duplicate = await service.applyTurnLifecycleEvent(acceptance);
    assert.equal(duplicate.applied, false);
    const timing = {
      userId: "u1",
      sessionId: "s1",
      persistenceContext,
      turnScopeId: "t1",
      dialogProcessId: accepted.dialogProcessId,
      thinkingFinishedAt: "2026-11-13T00:00:00.000Z",
      modelLoopRound: 1,
    };
    const updated = await service.upsertTurnTiming(timing);
    assert.equal(updated.upserted, true);
    const unchanged = await service.upsertTurnTiming(timing);
    assert.equal(unchanged.upserted, false);
    const reused = await service.assertReusedUserTurnIdentity(timing);
    assert.equal(reused.asserted, true);
    const results = [accepted, duplicate, updated, unchanged, reused];
    for (const [index] of results.entries()) {
      const publicRead = await repo.requireById("u1", "s1", { persistenceContext });
      for (const field of ["persistedMessageUids", "summarizedMessageUids"]) {
        assert.deepEqual(receiptOf(publicRead)[field], ["m1"]);
        receiptOf(publicRead)[field].push(`caller-${index}`);
      }
    }
    const restored = await repo.requireById("u1", "s1", { persistenceContext });
    for (const field of ["persistedMessageUids", "summarizedMessageUids"])
      assert.deepEqual(receiptOf(restored)[field], ["m1"]);
  });
});

test("borrowed receipt verification detects replaced, corrupt and missing checkpoint sources", async () =>
  withTemp(async (sessionDir) => {
    await seedCheckpoint(sessionDir);
    const options = { storageService, sessionDir, turnScopeIds: ["active"] };
    const initial = await readSessionTurnView(options);
    const manifest = JSON.parse(await readFile(path.join(sessionDir, "session.json"), "utf8"));
    const file = path.join(sessionDir, manifest.turnOrder[0].summarySnapshots[0].file);
    const original = await readFile(file, "utf8");
    await writeFile(`${file}.replacement`, original);
    await rename(`${file}.replacement`, file);
    assert.deepEqual(
      receiptOf((await readSessionTurnView(options)).session),
      receiptOf(initial.session),
    );
    await writeFile(file, original.replace('"checkpoint content"', '"corrupted content"'));
    await assert.rejects(readSessionTurnView(options), {
      code: "SESSION_SUMMARY_SNAPSHOT_HASH_MISMATCH",
    });
    await writeFile(file, original);
    assert.deepEqual(
      receiptOf((await readSessionTurnView(options)).session),
      receiptOf(initial.session),
    );
    await rm(file);
    await assert.rejects(readSessionTurnView(options), {
      code: "SESSION_SUMMARY_SNAPSHOT_INDEX_MISMATCH",
    });
    await writeFile(file, original);
    assert.deepEqual(receiptOf(await readSessionArtifact(options)), receiptOf(initial.session));
  }));
