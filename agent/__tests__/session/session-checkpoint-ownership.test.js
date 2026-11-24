/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import test from "node:test";
import assert from "node:assert/strict";
import { withProvisionedSessions } from "../helpers/provisioned-sessions.js";
import { commitTestSessionChanges } from "../helpers/session-services.js";
import { canonicalSessionMessages } from "../helpers/canonical-session-messages.js";
import { event } from "./turn-lifecycle-session-contract.test-helpers.js";
import { TURN_EVENT, TURN_PHASE } from "@noobot/session-protocol";

const fields = ["persistedMessageUids", "summarizedMessageUids"];
const receiptOf = (session) => session.turnSummaryCheckpoints.active.receipts[0];

async function seedCheckpoint(runtime) {
  await commitTestSessionChanges(runtime, {
    userId: "u1",
    sessionId: "s1",
    changes: {
      messages: canonicalSessionMessages(
        [
          {
            sessionId: "s1",
            parentSessionId: "",
            parentDialogProcessId: "",
            role: "assistant",
            messageUid: "m1",
            presentationMessageId: "pm_active",
            turnScopeId: "active",
            dialogProcessId: "active",
            content: "checkpoint content",
            attachments: [],
            transferEnvelopes: [],
            ts: "2026-01-01T00:00:00.000Z",
          },
        ],
        "s1",
      ),
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
}

test("checkpoint reads and exported UID lists cannot mutate persisted receipts", async () =>
  withProvisionedSessions({ userId: "u1", sessionIds: ["s1"] }, async ({ runtime }) => {
    await seedCheckpoint(runtime);
    const repo = runtime.repositories.sessionRepository;
    const persistenceContext = repo.treePersistenceContext("u1", "s1");
    await using reader = await repo.requireSessionReader("u1", "s1", { persistenceContext });
    const checkpoint = await reader.readCheckpointState("active");
    const exported = await reader.exportSession();
    assert.deepEqual(checkpoint.receipts[0], receiptOf(exported));
    for (const field of fields) receiptOf(exported)[field].push("caller-only");
    const restored = await reader.exportSession();
    for (const field of fields) assert.deepEqual(receiptOf(restored)[field], ["m1"]);
    assert.deepEqual(
      (await reader.readCheckpointState("active")).receipts[0],
      checkpoint.receipts[0],
    );
  }));

test("service mutations preserve unrelated checkpoints and public reads own their UID lists", async () =>
  withProvisionedSessions({ userId: "u1", sessionIds: ["s1"] }, async ({ runtime }) => {
    await seedCheckpoint(runtime);
    const repo = runtime.repositories.sessionRepository;
    const persistenceContext = repo.treePersistenceContext("u1", "s1");
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
    for (const [index] of [accepted, duplicate, updated, unchanged, reused].entries()) {
      const value = await repo.requireById("u1", "s1", { persistenceContext });
      for (const field of fields) {
        assert.deepEqual(receiptOf(value)[field], ["m1"]);
        receiptOf(value)[field].push(`caller-${index}`);
      }
    }
    const restored = await repo.requireById("u1", "s1", { persistenceContext });
    for (const field of fields) assert.deepEqual(receiptOf(restored)[field], ["m1"]);
  }));
