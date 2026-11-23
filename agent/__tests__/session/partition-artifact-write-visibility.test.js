/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { createPluginArtifactEnvelope } from "@noobot/event-protocol/plugin-artifact-event";
import { openPartitionSessionReader } from "../../src/session/partition-storage/partition-session-reader.js";
import {
  committedAt,
  createMessageCase,
  message,
  openTestMessages,
  prepare,
  scope,
} from "./partition-session-messages.test-helpers.js";

const identity = { pluginId: "example", artifactType: "document", artifactId: "visibility" };

function artifact(sessionId, aggregateVersion, turnScopeId, revision) {
  const source = createPluginArtifactEnvelope({
    ...identity,
    sessionId,
    turnScopeId,
    sequence: revision,
    revision,
    operation: revision === 1 ? "created" : "replaced",
    baseRevision: revision === 1 ? null : revision - 1,
    data: { revision },
    occurredAt: committedAt,
  });
  const envelope = { ...source, ordering: { ...source.ordering, aggregateVersion } };
  return { eventId: envelope.identity.eventId, envelope, committedAt, deliveries: {} };
}

for (const partial of [false, true]) {
  test(`retired artifact cannot be replaced through a fresh turn (${partial ? "partial" : "whole"} deletion)`, async (t) => {
    const { journal, sessionId } = await createMessageCase(t, { transactionBytes: 16 * 1024 });
    const repository = openTestMessages(journal, sessionId);
    const other = { turnScopeId: "other", dialogProcessId: "other-dialog" };
    await repository.commit(
      await prepare(journal, repository, "seed", {
        messages: [
          message(sessionId, "retained"),
          { ...message(sessionId, "anchor"), ...other },
          message(sessionId, "tail"),
        ],
      }),
    );
    const options = { journal, sessionId, parentSessionId: "" };
    await using before = await openPartitionSessionReader(options);
    const metadata = await before.readMetadata();
    await repository.commit(
      await prepare(journal, repository, "artifact", {
        artifactEvents: [artifact(sessionId, metadata.aggregateVersion + 1, scope.turnScopeId, 1)],
      }),
    );
    await using pinned = await openPartitionSessionReader(options);
    await repository.commit(
      await prepare(journal, repository, "delete", {
        messageDeletion: {
          commandId: "delete",
          anchor: { turnScopeId: partial ? other.turnScopeId : scope.turnScopeId },
        },
      }),
    );
    const fresh = { turnScopeId: "fresh", dialogProcessId: "fresh-dialog" };
    await repository.commit(
      await prepare(journal, repository, "fresh", {
        messages: [{ ...message(sessionId, "fresh-message"), ...fresh }],
      }),
    );
    await using current = await openPartitionSessionReader(options);
    assert.equal(await current.readPluginArtifact(identity), null);
    const state = await current.readMetadata();
    const head = journal.head;
    const request = await current.prepareRequest({
      operationId: "revive-through-fresh-turn",
      committedAt,
      changes: {
        sessionMetadata: { customTitle: "must-not-publish" },
        artifactEvents: [artifact(sessionId, state.aggregateVersion + 1, fresh.turnScopeId, 2)],
      },
    });
    await assert.rejects(repository.commit(request), { code: "SESSION_COMMIT_INPUT_INVALID" });
    assert.deepEqual(journal.head, head);
    await using reopened = await openPartitionSessionReader(options);
    assert.deepEqual(await reopened.readMetadata(), state);
    assert.equal(await reopened.readPluginArtifact(identity), null);
    assert.equal((await pinned.readPluginArtifact(identity)).revision, 1);
  });
}
