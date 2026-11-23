/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { PartitionJournal } from "../../src/session/partition-storage/partition-journal.js";
import { PartitionTransactions } from "../../src/session/partition-storage/partition-transactions.js";
import { commitFixtureTransaction } from "../helpers/partition-journal-cases.js";
import { prepareFixtureContextTruncation } from "../helpers/partition-context-truncation.js";
import {
  scope,
  message,
  prepare,
  openTestMessages,
  createMessageCase,
} from "./partition-session-messages.test-helpers.js";

const timing = { ...scope, modelLoopRound: 1 };

function acceptance(sessionId, commandId) {
  return {
    ...scope,
    sessionId,
    commandId,
    causationId: commandId,
    eventType: "turn.action_accepted",
    phase: "action",
    action: "send",
    presentationMessageId: "presentation-target",
    executionId: "agent:turn-1",
    executionKind: "agent",
    rootExecutionId: "agent:turn-1",
  };
}

async function truncate(journal, removeMembership = false) {
  const transactions = new PartitionTransactions(journal);
  await journal.usingSnapshot(async (snapshot) => {
    const owner = (
      await transactions.lookupLatestMany({
        snapshot,
        collection: "metadata",
        keys: ["messageCount"],
      })
    ).get("messageCount").owner;
    const mutations = [{ collection: "metadata", key: "messageCount", owner, value: 1 }];
    if (removeMembership) {
      const key = scope.turnScopeId;
      const entry = (
        await transactions.lookupLatestMany({ snapshot, collection: "turns", keys: [key] })
      ).get(key);
      mutations.push({ collection: "turns", key, owner: entry.owner, remove: true });
    }
    await prepareFixtureContextTruncation(transactions, snapshot, 1, mutations);
    await commitFixtureTransaction(transactions, {
      epoch: snapshot.epoch,
      expectedGeneration: snapshot.sequence,
      sequence: snapshot.sequence + 1,
      operationId: "truncate",
      input: {},
      result: null,
      mutations,
    });
  });
}

test("outbox validates a message created in the delivery transaction at its pending generation", async (t) => {
  const { journal, sessionId } = await createMessageCase(t, { transactionBytes: 16 * 1024 });
  const repository = openTestMessages(journal, sessionId);
  const accepted = await repository.commit(
    await prepare(journal, repository, "accept-only", {
      turnTransition: acceptance(sessionId, "accept-only"),
    }),
  );
  const event = accepted.result.turnTransition.committedEvent;
  const consumerId = "runtime-events";
  const request = await prepare(journal, repository, "create-and-deliver", {
    messages: [message(sessionId, "first")],
    deliveries: [
      {
        type: "acknowledge",
        eventId: event.eventId,
        consumerId,
        deliveredAt: "2026-11-19T00:00:00.000Z",
        orderingDomain: event.envelope.ordering.domain,
        orderingScopeId: event.envelope.ordering.scopeId,
        sequence: event.envelope.ordering.sequence,
      },
    ],
    outboxCursors: [{ consumerId, expectedCursor: 0, cursor: 1 }],
  });
  const committed = await repository.commit(request);
  assert.deepEqual(committed.result.outboxCursors, [{ consumerId, cursor: 1 }]);
  assert.deepEqual(await repository.commit(request), { ...committed, replayed: true });
  await journal.usingSnapshot(async (snapshot) => {
    const page = await repository.readOutboxPage({ snapshot, consumerId });
    assert.deepEqual(page.events, []);
    assert.equal(page.after, 1);
  });
});

for (const reuse of [false, true]) {
  test(`hidden turn retires outbox reads and delivery after cold reopen (reuse=${reuse})`, async (t) => {
    const { journal, sessionId, root } = await createMessageCase(t, {
      transactionBytes: 16 * 1024,
    });
    const repository = openTestMessages(journal, sessionId);
    const committed = await repository.commit(
      await prepare(journal, repository, "seed-outbox", {
        messages: [
          { ...message(sessionId, "history"), turnScopeId: "history-turn" },
          message(sessionId, "target"),
        ],
        turnTransition: acceptance(sessionId, "seed-outbox"),
      }),
    );
    const event = committed.result.turnTransition.committedEvent;
    const terminalEvents = [];
    for (const [eventType, phase, extra] of [
      ["turn.processing_started", "processing", {}],
      ["turn.processing_completed", "completion", { completionCommitId: "completed" }],
      [
        "turn.completed",
        "completion",
        { commandId: "completed", terminalStatus: { command: "completed" } },
      ],
    ]) {
      const receipt = await repository.commit(
        await prepare(journal, repository, eventType, {
          turnTransition: {
            ...scope,
            sessionId,
            eventType,
            phase,
            commandId: eventType,
            causationId: eventType,
            ...extra,
          },
        }),
      );
      assert.equal(receipt.result.turnTransition.applied, true);
      terminalEvents.push(receipt.result.turnTransition.committedEvent);
    }
    const hiddenSequence = terminalEvents.at(-1).envelope.ordering.sequence;
    const consumerId = "runtime-events";
    await journal.usingSnapshot(async (snapshot) => {
      await truncate(journal, reuse);
      if (reuse)
        await repository.commit(
          await prepare(journal, repository, "reuse-outbox-position", {
            messages: [{ ...message(sessionId, "new"), turnScopeId: "new-turn" }],
          }),
        );
      const page = await repository.readOutboxPage({ snapshot, consumerId });
      assert.deepEqual(
        page.events.map(({ eventId }) => eventId),
        [event, ...terminalEvents].map(({ eventId }) => eventId),
      );
    });
    await journal.close();
    const cold = await PartitionJournal.open({ root, sessionId });
    t.after(() => cold.close());
    const reader = openTestMessages(cold, sessionId);
    const before = await readFile(`${root}/CURRENT`);
    for (const type of ["attempt", "acknowledge"])
      await assert.rejects(
        reader.commit(
          await prepare(cold, reader, `hidden-${type}`, {
            sessionMetadata: { customTitle: "must not publish" },
            deliveries: [
              {
                type,
                eventId: event.eventId,
                consumerId,
                ...(type === "attempt"
                  ? { attemptedAt: "2026-11-19T00:00:00.000Z" }
                  : {
                      deliveredAt: "2026-11-19T00:00:00.000Z",
                      orderingDomain: event.envelope.ordering.domain,
                      orderingScopeId: event.envelope.ordering.scopeId,
                      sequence: event.envelope.ordering.sequence,
                    }),
              },
            ],
          }),
        ),
        { code: "SESSION_OUTBOX_EVENT_MISSING" },
      );
    assert.deepEqual(await readFile(`${root}/CURRENT`), before);
    await cold.usingSnapshot(async (snapshot) => {
      const page = await reader.readOutboxPage({ snapshot, consumerId });
      assert.deepEqual(page.events, []);
      assert.equal(page.cursor, hiddenSequence);
    });
    const next = await reader.commit(
      await prepare(cold, reader, "next-turn", {
        turnTransition: {
          ...acceptance(sessionId, "next-turn"),
          turnScopeId: "new-turn",
          executionId: "agent:new-turn",
          rootExecutionId: "agent:new-turn",
        },
      }),
    );
    assert.equal(next.result.turnTransition.applied, true);
    const nextEvent = next.result.turnTransition.committedEvent;
    assert.equal(nextEvent.envelope.ordering.sequence, hiddenSequence + 1);
    const beforeSkip = await readFile(`${root}/CURRENT`);
    await assert.rejects(
      reader.commit(
        await prepare(cold, reader, "skip-visible-event", {
          outboxCursors: [{ consumerId, expectedCursor: 0, cursor: hiddenSequence + 1 }],
        }),
      ),
      { code: "SESSION_OUTBOX_CURSOR_UNDELIVERED" },
    );
    assert.deepEqual(await readFile(`${root}/CURRENT`), beforeSkip);
    const request = await prepare(cold, reader, "skip-hidden-event", {
      outboxCursors: [{ consumerId, expectedCursor: 0, cursor: hiddenSequence }],
    });
    const cursor = await reader.commit(request);
    assert.deepEqual(cursor.result.outboxCursors, [{ consumerId, cursor: hiddenSequence }]);
    assert.deepEqual(await reader.commit(request), { ...cursor, replayed: true });
    await cold.usingSnapshot(async (snapshot) => {
      const page = await reader.readOutboxPage({ snapshot, consumerId });
      assert.deepEqual(
        page.events.map(({ eventId }) => eventId),
        [nextEvent.eventId],
      );
    });
  });
  for (const accepted of [false, true]) {
    test(`hidden turn rejects lifecycle after cold reopen (reuse=${reuse}, accepted=${accepted})`, async (t) => {
      const { journal, sessionId, root } = await createMessageCase(t, {
        transactionBytes: 16 * 1024,
      });
      const repository = openTestMessages(journal, sessionId);
      const request = await prepare(journal, repository, "seed", {
        messages: [
          { ...message(sessionId, "history"), turnScopeId: "history-turn" },
          message(sessionId, "target"),
        ],
        ...(accepted ? { turnTransition: acceptance(sessionId, "seed") } : {}),
      });
      const committed = await repository.commit(request);
      await truncate(journal);
      if (reuse)
        await repository.commit(
          await prepare(journal, repository, "reuse", {
            messages: [{ ...message(sessionId, "new"), turnScopeId: "new-turn" }],
          }),
        );
      await journal.close();
      const cold = await PartitionJournal.open({ root, sessionId });
      t.after(() => cold.close());
      const reader = openTestMessages(cold, sessionId);
      assert.deepEqual(await reader.commit(request), { ...committed, replayed: true });
      const before = await readFile(`${root}/CURRENT`);
      const turnTransition = accepted
        ? {
            ...scope,
            sessionId,
            commandId: "hidden-processing",
            causationId: "hidden-processing",
            eventType: "turn.processing_started",
            phase: "processing",
          }
        : acceptance(sessionId, "hidden-acceptance");
      await assert.rejects(
        reader.commit(
          await prepare(cold, reader, "hidden-lifecycle", {
            messages: [{ ...message(sessionId, "unpublished"), turnScopeId: "healthy-turn" }],
            sessionMetadata: { customTitle: "must not publish" },
            turnTransition,
          }),
        ),
        { code: "SESSION_TURN_IDENTITY_CONFLICT" },
      );
      assert.deepEqual(await readFile(`${root}/CURRENT`), before);
      await cold.usingSnapshot(async (snapshot) => {
        assert.deepEqual(
          (await reader.readSessionMessageOrderPage({ snapshot, cursor: null, limit: 8 })).entries,
          reuse ? ["history", "new"] : ["history"],
        );
      });
    });
  }
  for (const operation of ["timing", "empty checkpoint", "historical checkpoint"]) {
    test(`hidden turn rejects ${operation} after cold reopen (reuse=${reuse})`, async (t) => {
      const { journal, sessionId, root } = await createMessageCase(t);
      const repository = openTestMessages(journal, sessionId);
      const request = await prepare(journal, repository, "seed", {
        messages: [
          { ...message(sessionId, "history"), turnScopeId: "history-turn" },
          message(sessionId, "target"),
        ],
        timings: [timing],
      });
      const committed = await repository.commit(request);
      await journal.usingSnapshot(async (snapshot) => {
        await truncate(journal);
        if (reuse)
          await repository.commit(
            await prepare(journal, repository, "reuse", {
              messages: [{ ...message(sessionId, "new"), turnScopeId: "new-turn" }],
            }),
          );
        assert.deepEqual(
          await repository.readTurnTiming({ snapshot, turnScopeId: scope.turnScopeId }),
          timing,
        );
      });
      await journal.close();
      const cold = await PartitionJournal.open({ root, sessionId });
      t.after(() => cold.close());
      const reader = openTestMessages(cold, sessionId);
      assert.deepEqual(await reader.commit(request), { ...committed, replayed: true });
      const before = await readFile(`${root}/CURRENT`);
      if (operation === "timing") {
        await cold.usingSnapshot(async (snapshot) => {
          assert.equal(
            await reader.readTurnTiming({ snapshot, turnScopeId: scope.turnScopeId }),
            null,
          );
        });
      }
      await assert.rejects(
        reader.commit(
          await prepare(cold, reader, "hidden-update", {
            sessionMetadata: { customTitle: "must not publish" },
            ...(operation === "timing"
              ? { timings: [{ ...scope, modelLoopRound: 1 }] }
              : {
                  summaryCheckpoints: [
                    {
                      sessionId,
                      ...scope,
                      userId: "admin",
                      checkpointId: "summary",
                      expectedCheckpointRevision: 0,
                      messages: [],
                      persistedMessageUids: [],
                      summarizedMessageUids:
                        operation === "historical checkpoint" ? ["history"] : [],
                      retainedMessageUids: [],
                    },
                  ],
                }),
          }),
        ),
        {
          code:
            operation === "timing"
              ? "SESSION_TURN_TIMING_CONFLICT"
              : "TURN_SUMMARY_CHECKPOINT_MESSAGE_MISSING",
        },
      );
      assert.deepEqual(await readFile(`${root}/CURRENT`), before);
    });
  }
}
