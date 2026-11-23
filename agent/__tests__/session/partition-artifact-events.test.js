/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { createPluginArtifactEnvelope } from "@noobot/event-protocol/plugin-artifact-event";
import { PartitionJournal } from "../../src/session/partition-storage/partition-journal.js";
import { PartitionSessionMessages } from "../../src/session/partition-storage/partition-session-messages.js";
import { createTransactionCase } from "../helpers/partition-journal-cases.js";
import { initializePartitionSession } from "../helpers/partition-session-cases.js";
import { message } from "./partition-session-messages.test-helpers.js";
import { getFsAdapter, setFsAdapter } from "../../src/shared/storage/fs-adapter.js";

const committedAt = "2026-11-20T00:00:00.000Z";
const identity = { pluginId: "workflow", artifactType: "result", artifactId: "result-1" };
const turnScopeId = "turn-1";
const consumerId = "runtime-events";

function artifact(sessionId, aggregateVersion, revision = 1, targetTurn = turnScopeId) {
  const envelope = createPluginArtifactEnvelope({
    ...identity,
    sessionId,
    turnScopeId: targetTurn,
    data: { text: `结果-${revision}`, nested: [null, false, { value: revision }] },
    operation: revision === 1 ? "created" : "replaced",
    baseRevision: revision === 1 ? null : revision - 1,
    revision,
    sequence: revision,
    occurredAt: committedAt,
  });
  return {
    eventId: envelope.identity.eventId,
    envelope: { ...envelope, ordering: { ...envelope.ordering, aggregateVersion } },
    committedAt: "2026-11-20T00:00:01.000Z",
    deliveries: {},
  };
}

async function fixture(t, options) {
  const context = await createTransactionCase(t, { transactionBytes: 16 * 1024 }, options);
  await initializePartitionSession(
    context.journal,
    {
      sessionId: context.sessionId,
      parentSessionId: "",
    },
    committedAt,
  );
  return { ...context, repository: open(context.journal, context.sessionId) };
}
function open(journal, sessionId) {
  return new PartitionSessionMessages(journal, { sessionId, parentSessionId: "" });
}
function prepare(journal, repository, operationId, changes) {
  return journal.usingSnapshot((snapshot) =>
    repository.prepareRequest(snapshot, {
      operationId,
      changes,
      committedAt,
    }),
  );
}
function readArtifact(journal, repository) {
  return journal.usingSnapshot((snapshot) =>
    repository.readPluginArtifact({ snapshot, ...identity }),
  );
}
function page(journal, repository) {
  return journal.usingSnapshot((snapshot) => repository.readOutboxPage({ snapshot, consumerId }));
}
async function seed(context) {
  const { journal, repository, sessionId } = context;
  await repository.commit(
    await prepare(journal, repository, "seed", {
      messages: [message(sessionId, "seed-message")],
    }),
  );
}

test("partition artifacts publish versions, projection and delivery atomically and replay cold", async (t) => {
  const context = await fixture(t);
  const { journal, repository, sessionId } = context;
  await seed(context);
  const version = (await journal.usingSnapshot((snapshot) => repository.readMetadata({ snapshot })))
    .aggregateVersion;
  const event = artifact(sessionId, version + 1);
  const request = await prepare(journal, repository, "create-artifact", {
    artifactEvents: [event],
  });
  const first = await repository.commit(request);
  assert.deepEqual(first.result.events, [event.envelope]);
  assert.equal(first.result.turnTransition, undefined);
  const oldSnapshot = await journal.snapshot();
  const replacement = artifact(sessionId, version + 2, 2);
  await repository.commit(
    await prepare(journal, repository, "replace-artifact", {
      artifactEvents: [replacement],
    }),
  );
  assert.equal(
    (await repository.readPluginArtifact({ snapshot: oldSnapshot, ...identity })).revision,
    1,
  );
  await journal.releaseSnapshot(oldSnapshot);
  await journal.close();
  const cold = await PartitionJournal.open({ root: context.root, sessionId });
  t.after(() => cold.close());
  const reopened = open(cold, sessionId);
  assert.equal((await readArtifact(cold, reopened)).revision, 2);
  assert.deepEqual(
    (await page(cold, reopened)).events.map(({ envelope }) => envelope),
    [event.envelope, replacement.envelope],
  );
  const replay = await reopened.commit(request);
  assert.equal(replay.replayed, true);
  assert.deepEqual(replay.result.events, [event.envelope]);
  assert.equal((await page(cold, reopened)).events.length, 2);
});

for (const [label, alter] of [
  [
    "foreign session",
    (event) => {
      event.envelope.identity.sessionId = "foreign";
    },
  ],
  [
    "missing turn",
    (event) => {
      event.envelope.identity.turnScopeId = "missing";
    },
  ],
  [
    "wrong aggregate version",
    (event) => {
      event.envelope.ordering.aggregateVersion += 1;
    },
  ],
  [
    "invalid payload",
    (event) => {
      event.envelope.payload.revision = 7;
    },
  ],
]) {
  test(`partition artifact rejects ${label} without publishing mixed metadata`, async (t) => {
    const context = await fixture(t);
    const { journal, repository, sessionId } = context;
    await seed(context);
    const before = await journal.usingSnapshot((snapshot) => repository.readMetadata({ snapshot }));
    const event = structuredClone(artifact(sessionId, before.aggregateVersion + 1));
    alter(event);
    const request = await prepare(journal, repository, label, {
      sessionMetadata: { customTitle: "must-not-publish" },
      artifactEvents: [event],
    });
    await assert.rejects(repository.commit(request), { code: "SESSION_COMMIT_INPUT_INVALID" });
    assert.equal(await readArtifact(journal, repository), null);
    assert.deepEqual(
      await journal.usingSnapshot((snapshot) => repository.readMetadata({ snapshot })),
      before,
    );
    assert.equal((await page(journal, repository)).events.length, 0);
  });
}

test("artifact duplicate identity and stale sequence reject the entire request", async (t) => {
  const context = await fixture(t);
  const { journal, repository, sessionId } = context;
  await seed(context);
  const version = (await journal.usingSnapshot((snapshot) => repository.readMetadata({ snapshot })))
    .aggregateVersion;
  const event = artifact(sessionId, version + 1);
  await repository.commit(await prepare(journal, repository, "first", { artifactEvents: [event] }));
  const stale = artifact(sessionId, version + 2, 2);
  stale.envelope.ordering.sequence = 1;
  for (const [id, source, code] of [
    ["duplicate", event, "SESSION_EVENT_CONFLICT"],
    ["stale", stale, "SESSION_EVENT_SEQUENCE_CONFLICT"],
  ]) {
    const request = await prepare(journal, repository, id, { artifactEvents: [source] });
    await assert.rejects(repository.commit(request), { code });
  }
  assert.equal((await readArtifact(journal, repository)).revision, 1);
});

test("an existing lifecycle-only turn accepts artifacts without requiring a message", async (t) => {
  const { journal, repository, sessionId } = await fixture(t);
  await repository.commit(
    await prepare(journal, repository, "accept", {
      turnTransition: {
        sessionId,
        turnScopeId,
        dialogProcessId: "dialog-1",
        commandId: "accept",
        causationId: "accept",
        eventType: "turn.action_accepted",
        phase: "action",
        action: "send",
        presentationMessageId: "presentation",
        executionId: "agent:turn-1",
        executionKind: "agent",
        rootExecutionId: "agent:turn-1",
      },
    }),
  );
  const metadata = await journal.usingSnapshot((snapshot) => repository.readMetadata({ snapshot }));
  const event = artifact(sessionId, metadata.aggregateVersion + 1);
  await repository.commit(
    await prepare(journal, repository, "lifecycle-artifact", { artifactEvents: [event] }),
  );
  assert.equal((await readArtifact(journal, repository)).revision, 1);
  assert.equal((await page(journal, repository)).events.length, 2);
});

test("whole-turn replacement retires its artifact in the same publication and preserves the old snapshot", async (t) => {
  const { journal, repository, sessionId } = await fixture(t);
  const {
    modelMessageId: _model,
    presentationMessageId: _presentation,
    ...fields
  } = message(sessionId, "natural");
  await repository.commit(
    await prepare(journal, repository, "seed-natural", {
      messages: [
        { ...fields, role: "user", userMessageId: "natural-user", messageOrigin: "natural" },
      ],
    }),
  );
  const metadata = await journal.usingSnapshot((snapshot) => repository.readMetadata({ snapshot }));
  await repository.commit(
    await prepare(journal, repository, "artifact", {
      artifactEvents: [artifact(sessionId, metadata.aggregateVersion + 1)],
    }),
  );
  await journal.usingSnapshot(async (old) => {
    const publications = journal.work.publications;
    await repository.commit(
      await prepare(journal, repository, "replace-turn", {
        turnReplacement: {
          command: {
            commandId: "replace-turn",
            anchor: { turnScopeId },
            turnScopeId: "replacement-turn",
            newContent: "replacement",
            attachments: [],
          },
          identity: {
            dialogProcessId: "replacement-dialog",
            messageUid: "replacement-message",
            userMessageId: "replacement-user",
          },
        },
      }),
    );
    assert.equal(journal.work.publications, publications + 1);
    assert.equal((await repository.readPluginArtifact({ snapshot: old, ...identity })).revision, 1);
    assert.equal(await readArtifact(journal, repository), null);
    assert.equal((await page(journal, repository)).events.length, 0);
  });
});

for (const partial of [false, true]) {
  test(`artifact retirement survives cold reopen and retained-message append (${partial ? "partial" : "whole"} turn)`, async (t) => {
    const context = await fixture(t);
    const { journal, repository, sessionId, root } = context;
    const other = { turnScopeId: "other-turn", dialogProcessId: "other-dialog" };
    await repository.commit(
      await prepare(journal, repository, "interleaved", {
        messages: [
          message(sessionId, "retained"),
          { ...message(sessionId, "anchor"), ...other },
          message(sessionId, "removed"),
        ],
      }),
    );
    const metadata = await journal.usingSnapshot((snapshot) =>
      repository.readMetadata({ snapshot }),
    );
    await repository.commit(
      await prepare(journal, repository, "artifact", {
        artifactEvents: [artifact(sessionId, metadata.aggregateVersion + 1)],
      }),
    );
    const old = await journal.snapshot();
    const deletion = await prepare(journal, repository, "delete", {
      messageDeletion: {
        commandId: "delete",
        anchor: { turnScopeId: partial ? other.turnScopeId : turnScopeId },
      },
    });
    await repository.commit(deletion);
    assert.equal((await repository.readPluginArtifact({ snapshot: old, ...identity })).revision, 1);
    assert.equal(await readArtifact(journal, repository), null);
    assert.equal((await page(journal, repository)).events.length, 0);
    await journal.releaseSnapshot(old);
    await journal.close();
    const cold = await PartitionJournal.open({ root, sessionId });
    t.after(() => cold.close());
    const reader = open(cold, sessionId);
    assert.equal((await reader.commit(deletion)).replayed, true);
    assert.equal(await readArtifact(cold, reader), null);
    if (partial) {
      await reader.commit(
        await prepare(cold, reader, "append-retained", { messages: [message(sessionId, "later")] }),
      );
      assert.equal(await readArtifact(cold, reader), null);
      const current = await cold.usingSnapshot((snapshot) => reader.readMetadata({ snapshot }));
      const rejected = await prepare(cold, reader, "revive", {
        artifactEvents: [artifact(sessionId, current.aggregateVersion + 1, 2)],
        sessionMetadata: { customTitle: "must-not-publish" },
      });
      await assert.rejects(reader.commit(rejected), { code: "SESSION_COMMIT_INPUT_INVALID" });
      assert.deepEqual(
        await cold.usingSnapshot((snapshot) => reader.readMetadata({ snapshot })),
        current,
      );
    }
  });
}

test("a cross-turn artifact replacement does not fall back to an older revision after retirement", async (t) => {
  const context = await fixture(t);
  const { journal, repository, sessionId } = context;
  const other = { turnScopeId: "other-turn", dialogProcessId: "other-dialog" };
  await seed(context);
  let metadata = await journal.usingSnapshot((snapshot) => repository.readMetadata({ snapshot }));
  await repository.commit(
    await prepare(journal, repository, "first", {
      artifactEvents: [artifact(sessionId, metadata.aggregateVersion + 1)],
    }),
  );
  await repository.commit(
    await prepare(journal, repository, "other", {
      messages: [{ ...message(sessionId, "other-message"), ...other }],
    }),
  );
  metadata = await journal.usingSnapshot((snapshot) => repository.readMetadata({ snapshot }));
  await repository.commit(
    await prepare(journal, repository, "replacement", {
      artifactEvents: [artifact(sessionId, metadata.aggregateVersion + 1, 2, other.turnScopeId)],
    }),
  );
  assert.equal((await readArtifact(journal, repository)).revision, 2);
  await repository.commit(
    await prepare(journal, repository, "delete-other", {
      messageDeletion: { commandId: "delete-other", anchor: { turnScopeId: other.turnScopeId } },
    }),
  );
  assert.equal(await readArtifact(journal, repository), null);
  assert.equal((await page(journal, repository)).events.length, 1);
});

test("artifact publication failure preserves metadata, projection and event order and retries cold", async (t) => {
  const context = await fixture(t, { autoClose: false });
  const { journal, repository, sessionId, root } = context;
  await seed(context);
  const before = await journal.usingSnapshot((snapshot) => repository.readMetadata({ snapshot }));
  const request = await prepare(journal, repository, "fault-artifact", {
    artifactEvents: [artifact(sessionId, before.aggregateVersion + 1)],
    sessionMetadata: { customTitle: "atomic-title" },
  });
  const adapter = getFsAdapter();
  let injected = false;
  setFsAdapter({
    ...adapter,
    async rename(source, target) {
      if (String(target).endsWith("/CURRENT")) {
        injected = true;
        throw new Error("artifact publication fault");
      }
      return adapter.rename(source, target);
    },
  });
  try {
    await assert.rejects(repository.commit(request), { code: "SESSION_COMMIT_UNCERTAIN" });
    await assert.rejects(journal.close(), { code: "SESSION_COMMIT_UNCERTAIN" });
  } finally {
    setFsAdapter(adapter);
  }
  assert.equal(injected, true);
  const cold = await PartitionJournal.open({ root, sessionId });
  t.after(() => cold.close());
  const reader = open(cold, sessionId);
  assert.equal(await readArtifact(cold, reader), null);
  assert.equal((await page(cold, reader)).events.length, 0);
  assert.deepEqual(
    await cold.usingSnapshot((snapshot) => reader.readMetadata({ snapshot })),
    before,
  );
  assert.equal((await reader.commit(request)).replayed, false);
  assert.equal((await readArtifact(cold, reader)).revision, 1);
  assert.equal((await page(cold, reader)).events.length, 1);
  assert.equal((await reader.commit(request)).replayed, true);
  assert.equal((await page(cold, reader)).events.length, 1);
});

test("multiple artifacts share transaction metadata and reject a later invalid version atomically", async (t) => {
  const context = await fixture(t);
  const { journal, repository, sessionId, root } = context;
  await seed(context);
  const before = await journal.usingSnapshot((snapshot) => repository.readMetadata({ snapshot }));
  const head = structuredClone(journal.head);
  const bytes = journal.work.writeBytes;
  const transactionTime = "2026-11-23T00:00:00.000Z";
  const first = artifact(sessionId, before.aggregateVersion + 1);
  const second = artifact(sessionId, before.aggregateVersion + 2, 2);
  const request = (events) =>
    journal.usingSnapshot((snapshot) =>
      repository.prepareRequest(snapshot, {
        operationId: "multiple-artifacts",
        committedAt: transactionTime,
        changes: {
          sessionMetadata: { customTitle: "atomic settings" },
          artifactEvents: events,
        },
      }),
    );
  const invalid = structuredClone(second);
  invalid.envelope.ordering.aggregateVersion += 1;
  await assert.rejects(repository.commit(await request([first, invalid])), {
    code: "SESSION_COMMIT_INPUT_INVALID",
  });
  assert.deepEqual(journal.head, head);
  assert.equal(journal.work.writeBytes, bytes);
  assert.equal(await readArtifact(journal, repository), null);
  assert.equal((await page(journal, repository)).events.length, 0);
  assert.deepEqual(
    await journal.usingSnapshot((snapshot) => repository.readMetadata({ snapshot })),
    before,
  );
  const valid = await request([first, second]);
  await repository.commit(valid);
  const expected = {
    ...before,
    customTitle: "atomic settings",
    aggregateVersion: before.aggregateVersion + 2,
    updatedAt: transactionTime,
  };
  assert.deepEqual(
    await journal.usingSnapshot((snapshot) => repository.readMetadata({ snapshot })),
    expected,
  );
  await journal.close();
  const cold = await PartitionJournal.open({ root, sessionId });
  t.after(() => cold.close());
  const reopened = open(cold, sessionId);
  assert.deepEqual(
    await cold.usingSnapshot((snapshot) => reopened.readMetadata({ snapshot })),
    expected,
  );
  assert.equal((await readArtifact(cold, reopened)).revision, 2);
  assert.deepEqual(
    (await page(cold, reopened)).events.map(({ envelope }) => envelope),
    [first.envelope, second.envelope],
  );
  assert.equal((await reopened.commit(valid)).replayed, true);
  assert.equal(cold.work.writeBytes, 0);
});
