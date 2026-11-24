/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { PARTITION_SESSION_METADATA } from "@noobot/session-protocol/partition-transaction";
import { requireSessionInitialization } from "@noobot/session-protocol/session-initialization";
import { preparePartitionSessionImport } from "@noobot/session-protocol/partition-session-initialization";
import { PartitionTransactions } from "../../src/session/partition-storage/partition-transactions.js";
import { PartitionJournal } from "../../src/session/partition-storage/partition-journal.js";
import { PartitionSessionTransactions } from "../../src/session/partition-storage/partition-session-transactions.js";
import { prepareLiveMessages } from "../../src/session/partition-storage/partition-message-transaction-plan.js";
import { createTransactionCase } from "../helpers/partition-journal-cases.js";
import { emptyPartitionSession } from "../helpers/partition-session-cases.js";
import { createMessageCase } from "./partition-session-messages.test-helpers.js";

const invalidWrites = [
  ...[
    "messages",
    "dialogOrder",
    "turnTimings",
    "sessionArtifactEvents",
    "turnLifecycle",
    "turnSummaryCheckpoints",
  ].map((field) => [`collection fact ${field}`, (value) => ({ value: { ...value, [field]: [] } })]),
  ...[
    "version",
    "revision",
    "sessionArtifacts",
    "turnTerminalCommits",
    "shortMemoryCheckpoint",
    "turnStatuses",
    "mutationReceipts",
  ].map((field) => [`retired ${field}`, (value) => ({ value: { ...value, [field]: null } })]),
  ["derived title", (value) => ({ value: { ...value, autoTitle: "stale" } })],
  ["empty derived title", (value) => ({ value: { ...value, autoTitle: "" } })],
  ["null derived title", (value) => ({ value: { ...value, autoTitle: null } })],
  ["numeric model alias", (value) => ({ value: { ...value, modelAlias: 42 } })],
  ["missing model alias", ({ modelAlias: _alias, ...value }) => ({ value })],
  ["blank custom title", (value) => ({ value: { ...value, customTitle: " " } })],
  ["null custom title", (value) => ({ value: { ...value, customTitle: null } })],
  ["non-array connector selection", (value) => ({ value: { ...value, selectedConnectorIds: {} } })],
  [
    "duplicate connector selection",
    (value) => ({ value: { ...value, selectedConnectorIds: ["one", "one"] } }),
  ],
  [
    "noncanonical connector selection",
    (value) => ({ value: { ...value, selectedConnectorIds: [" one "] } }),
  ],
  ["missing connector selection", ({ selectedConnectorIds: _ids, ...value }) => ({ value })],
  ["deleted metadata", () => ({ remove: true })],
  ["foreign session", (value) => ({ value: { ...value, sessionId: "foreign" } })],
  ["foreign parent", (value) => ({ value: { ...value, parentSessionId: "foreign" } })],
  ["negative aggregate version", (value) => ({ value: { ...value, aggregateVersion: -1 } })],
  ["string aggregate version", (value) => ({ value: { ...value, aggregateVersion: "0" } })],
  ["unsafe aggregate version", (value) => ({ value: { ...value, aggregateVersion: 2 ** 53 } })],
  ["invalid caller", (value) => ({ value: { ...value, caller: "unknown" } })],
  ["invalid creation time", (value) => ({ value: { ...value, createdAt: "invalid" } })],
  ["noncanonical update time", (value) => ({ value: { ...value, updatedAt: "2026-11-23" } })],
];

function initialTurn(sessionId) {
  const identity = { sessionId, dialogProcessId: "dialog", turnScopeId: "turn" };
  return {
    committedAt: "2026-11-23T00:00:00.000Z",
    changes: {
      turnTransition: {
        ...identity,
        commandId: "send",
        causationId: "send",
        eventType: "turn.action_accepted",
        phase: "action",
        action: "send",
        presentationMessageId: "presentation",
        executionId: "agent:turn",
        executionKind: "agent",
        rootExecutionId: "agent:turn",
      },
      messages: [
        {
          ...identity,
          messageUid: "user-message",
          userMessageId: "input",
          role: "user",
          type: "message",
          messageOrigin: "natural",
          content: "first input",
          attachments: [],
          ts: "2026-11-23T00:00:00.000Z",
          pending: true,
          turnCommit: { action: "send", commandId: "send" },
        },
      ],
    },
  };
}

for (const initialize of [false, true]) {
  for (const [label, invalidate] of invalidWrites) {
    test(`${initialize ? "initial turn" : "session commit"} rejects ${label} before publication and permits retry`, async (t) => {
      const fixture = initialize ? createTransactionCase : createMessageCase;
      const { journal, root, sessionId } = await fixture(t);
      const scope = { sessionId, parentSessionId: "" };
      const sessions = new PartitionSessionTransactions(journal, scope);
      const request = initialize
        ? await journal.usingSnapshot((snapshot) =>
            sessions.prepareInitialization(snapshot, {
              operationId: "metadata-write",
              session: emptyPartitionSession({
                ...scope,
                committedAt: "2026-11-23T00:00:00.000Z",
              }),
              scopedMetadata: null,
              initialTurn: initialTurn(sessionId),
            }),
          )
        : {
            epoch: journal.head.epoch,
            expectedGeneration: journal.head.sequence,
            operationId: "metadata-write",
            input: null,
          };
      const head = structuredClone(journal.head);
      const bytes = journal.work.writeBytes;
      let expected;
      const prepare = (invalid) => async (snapshot, view, input) => {
        const { collection, key } = PARTITION_SESSION_METADATA;
        if (initialize) {
          const prepared = await prepareLiveMessages(snapshot, view, input, scope);
          const mutation = prepared.mutations.find(
            (entry) => entry.collection === collection && entry.key === key,
          );
          expected = mutation.value;
          if (invalid) {
            delete mutation.value;
            Object.assign(mutation, invalidate(expected));
          }
          return prepared;
        }
        const entry = (await view.getLatestMany({ collection, keys: [key] })).get(key);
        expected = entry.mutation.value;
        return {
          action: "commit",
          mutations: [
            {
              collection,
              key,
              owner: entry.owner,
              ...(invalid ? invalidate(expected) : { value: expected }),
            },
          ],
          result: {},
        };
      };
      const submit = (prepare) =>
        initialize
          ? sessions.initialize(request, prepare, () => ({}))
          : sessions.commit(request, prepare);
      await assert.rejects(submit(prepare(true)), { code: "SESSION_PUBLICATION_CONTRACT" });
      assert.deepEqual(journal.head, head);
      assert.equal(journal.work.writeBytes, bytes);
      const outcome = await submit(prepare(false));
      assert.equal(outcome.status, "committed");
      assert.equal(outcome.generation, head.sequence + 1);
      const mustNotPrepare = () => assert.fail("Replay must not prepare");
      assert.deepEqual(await submit(mustNotPrepare), { ...outcome, replayed: true });
      await journal.close();
      const cold = await PartitionJournal.open({ root, sessionId });
      t.after(() => cold.close());
      const reader = new PartitionSessionTransactions(cold, scope);
      await cold.usingSnapshot(async (snapshot) => {
        assert.deepEqual(await reader.readMetadata(snapshot), expected);
      });
      const replay = initialize
        ? reader.initialize(request, mustNotPrepare, () => ({}))
        : reader.commit(request, mustNotPrepare);
      assert.deepEqual(await replay, { ...outcome, replayed: true });
      assert.equal(cold.work.writeBytes, 0);
    });
  }
}

for (const imported of [false, true]) {
  for (const autoTitle of ["stale", "", null]) {
    test(`${imported ? "import" : "initialization"} rejects input autoTitle ${JSON.stringify(autoTitle)} without stripping it`, async (t) => {
      const { journal, root, sessionId } = await createTransactionCase(t);
      const scope = { sessionId, parentSessionId: "" };
      const sessions = new PartitionSessionTransactions(journal, scope);
      const session = emptyPartitionSession({
        ...scope,
        committedAt: "2026-11-23T00:00:00.000Z",
      });
      const { metadata } = requireSessionInitialization({ session, initialTurn: null }, scope);
      const submit = (invalid) => {
        const valid = imported ? metadata : session;
        const value = invalid ? { ...valid, autoTitle } : valid;
        if (imported)
          return new PartitionTransactions(journal).commit(
            {
              epoch: journal.head.epoch,
              expectedGeneration: 0,
              operationId: "import-metadata",
              input: { metadata: value, scopedMetadata: null, dialogSequence: 0 },
            },
            {
              validateScope: () => {},
              prepare: (snapshot, view, input) =>
                preparePartitionSessionImport(snapshot, view.generation, input, scope),
            },
          );
        return journal.usingSnapshot(async (snapshot) =>
          sessions.initialize(
            await sessions.prepareInitialization(snapshot, {
              operationId: "initialize-metadata",
              session: value,
              scopedMetadata: null,
            }),
          ),
        );
      };
      const head = structuredClone(journal.head);
      const bytes = journal.work.writeBytes;
      await assert.rejects(submit(true), { code: "SESSION_PUBLICATION_CONTRACT" });
      assert.deepEqual(journal.head, head);
      assert.equal(journal.work.writeBytes, bytes);
      assert.equal((await submit(false)).generation, 1);
      await journal.close();
      const cold = await PartitionJournal.open({ root, sessionId });
      t.after(() => cold.close());
      await cold.usingSnapshot(async (snapshot) => {
        const reader = new PartitionSessionTransactions(cold, scope);
        assert.deepEqual(await reader.readMetadata(snapshot), metadata);
      });
    });
  }
}
