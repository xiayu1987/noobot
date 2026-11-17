/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import test from "node:test";
import assert from "node:assert/strict";
import { corruptRecord } from "./helpers/immutable-record-reads.js";
import { withProvisionedSessions } from "../helpers/provisioned-sessions.js";
import { commitTestSessionChanges } from "../helpers/session-services.js";
import { turnRecord } from "../helpers/turn-record.js";
import { createSessionTurnLifecycleSnapshot } from "../../src/session/session-turn-read-model.js";
import { ImmutableSessionStore } from "../../src/session/session-artifact-session/immutable-session-store.js";
import { ImmutableSessionChanges } from "../../src/session/session-artifact-session/immutable-message-changes.js";
import { prepareImmutableLifecycleIndex } from "../../src/session/session-artifact-session/immutable-lifecycle-index.js";

test("immutable lifecycle snapshots preserve visible terminal scope, limits and unchanged responses", async (t) => {
  await withProvisionedSessions(
    { userId: "u1", sessionIds: ["s1"] },
    async ({ runtime, scopes }) => {
      const repo = runtime.repositories.sessionRepository;
      const persistenceContext = repo.treePersistenceContext("u1", "s1");
      const states = ["completed", "stop_completed", "action_failed", "completed"];
      const turns = Object.fromEntries(
        states.map((state, index) => {
          const turnScopeId = `turn-${index}`;
          return [
            turnScopeId,
            turnRecord({
              turnScopeId,
              dialogProcessId: `dialog-${index}`,
              state,
              sequence: index + 1,
            }),
          ];
        }),
      );
      const messages = [0, 1].map((index) => ({
        messageUid: `message-${index}`,
        ts: "2026-11-12T00:00:00.000Z",
        sessionId: "s1",
        parentSessionId: "",
        parentDialogProcessId: "",
        userMessageId: `message-${index}`,
        role: "user",
        messageOrigin: "natural",
        content: `request ${index}`,
        dialogProcessId: `dialog-${index}`,
        turnScopeId: `turn-${index}`,
        attachments: [],
      }));
      await commitTestSessionChanges(runtime, {
        userId: "u1",
        sessionId: "s1",
        changes: { messages },
      });
      const store = new ImmutableSessionStore({
        sessionDir: scopes.s1.sessionDir,
        sessionId: "s1",
      });
      const snapshot = await store.snapshot();
      const lifecycle = await store.get(snapshot, "metadata", "lifecycle");
      await store.transact({
        expectedGeneration: snapshot.generation,
        operationId: "seed-terminal-snapshot",
        input: {},
        prepare: async ({ get }) => {
          const plan = new ImmutableSessionChanges(get);
          plan.set("metadata", "lifecycle", { ...lifecycle, sequence: states.length });
          for (const [scope, turn] of Object.entries(turns)) plan.set("lifecycle", scope, turn);
          await prepareImmutableLifecycleIndex(plan);
          return { changes: plan.changes() };
        },
      });
      const full = await repo.requireById("u1", "s1", { persistenceContext });
      const committed = await store.snapshot();
      await store.objects.withSnapshot(committed, async () => {
        const messagesRoot = await store.index.get(committed.root, "messages");
        for (const message of messages) {
          const reference = await store.index.get(messagesRoot, message.messageUid);
          assert.ok(reference);
          await corruptRecord(store, reference);
        }
      });
      const entries = ImmutableSessionStore.prototype.entries;
      t.mock.method(ImmutableSessionStore.prototype, "entries", function (pinned, collection) {
        assert.notEqual(
          collection,
          "replacements",
          "runtime snapshots must not enumerate tombstone history",
        );
        return entries.call(this, pinned, collection);
      });
      t.mock.method(repo, "findById", () => {
        throw new Error("lifecycle query must not materialize message bodies");
      });
      for (const terminalLimit of [1, 10]) {
        for (const knownSequence of [0, full.turnLifecycle.sequence]) {
          const options = { commandId: "snapshot", knownSequence, terminalLimit };
          const response = await runtime.sessionMessageService.getTurnLifecycleSnapshot({
            userId: "u1",
            sessionId: "s1",
            persistenceContext,
            ...options,
            resolveRecovery: async () => "none",
          });
          assert.equal(response.found, true);
          assert.deepEqual(
            response.snapshot,
            createSessionTurnLifecycleSnapshot({
              ...options,
              session: full,
              messageTurnScopeIds: full.messages.map((message) => message.turnScopeId),
              recovery: "none",
              generatedAt: response.snapshot.generatedAt,
            }),
          );
          if (terminalLimit === 10)
            assert.deepEqual(
              response.snapshot.recentTerminalTurns.map((turn) => turn.turnScopeId),
              ["turn-2", "turn-1", "turn-0"],
            );
        }
      }
      await repo.markSessionsDeleted("u1", ["s1"]);
      const missing = await runtime.sessionMessageService.getTurnLifecycleSnapshot({
        userId: "u1",
        sessionId: "s1",
        persistenceContext,
        resolveRecovery: async () => assert.fail("deleted session must not resolve recovery"),
      });
      assert.equal(missing.found, false);
    },
  );
});
