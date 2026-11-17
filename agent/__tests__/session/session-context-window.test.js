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
import { ImmutableSessionStore } from "../../src/session/session-artifact-session/immutable-session-store.js";
import { createContextScope, projectContextSource } from "@noobot/context-protocol";
import { TURN_THRESHOLDS } from "@noobot/shared/turn-thresholds";

test("context window reads selected immutable objects without full-history dependencies", async (t) => {
  await withProvisionedSessions(
    { userId: "u1", sessionIds: ["s1"] },
    async ({ runtime, session, scopes }) => {
      const repo = runtime.repositories.sessionRepository;
      const persistenceContext = repo.treePersistenceContext("u1", "s1");
      const historyLimit = TURN_THRESHOLDS.session.mainModelHistoryRoundLimit;
      const messages = Array.from({ length: historyLimit + 3 }, (_, index) => ({
        messageUid: `message-${index}`,
        ts: "2026-11-12T00:00:00.000Z",
        sessionId: "s1",
        parentSessionId: "",
        parentDialogProcessId: "",
        userMessageId: `message-${index}`,
        role: "user",
        messageOrigin: "natural",
        content: `message ${index}`,
        dialogProcessId: `dialog-${index}`,
        turnScopeId: `turn-${index}`,
        attachments: [],
      }));
      await commitTestSessionChanges(runtime, {
        userId: "u1",
        sessionId: "s1",
        changes: { messages },
      });
      const full = await repo.requireById("u1", "s1", { persistenceContext });
      const scope = createContextScope(full.messages.at(-1));
      const expected = projectContextSource({ source: full, scope, historyLimit });
      const store = new ImmutableSessionStore({
        sessionDir: scopes.s1.sessionDir,
        sessionId: "s1",
      });
      const snapshot = await store.snapshot();
      const reference = await store.objects.withSnapshot(snapshot, async () => {
        const messagesRoot = await store.index.get(snapshot.root, "messages");
        return store.index.get(messagesRoot, messages[0].messageUid);
      });
      assert.ok(reference);
      await corruptRecord(store, reference);
      t.mock.method(repo, "findById", () => {
        throw new Error("full history read is forbidden");
      });
      const actual = await session.getContextProjection({
        userId: "u1",
        sessionId: "s1",
        persistenceScope: null,
        currentTurnScopeId: scope.turnScopeId,
        currentDialogProcessId: scope.dialogProcessId,
      });
      assert.deepEqual(actual, expected);
      assert.equal(actual.messages.length, historyLimit);
    },
  );
});
