/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { persistSessionDeletionMarkers } from "../helpers/session-services.js";
import test from "node:test";
import assert from "node:assert/strict";
import { rm } from "node:fs/promises";
import { withProvisionedSessions } from "../helpers/provisioned-sessions.js";
import { createAcceptedAgentExecution } from "../helpers/accepted-run-identity.js";
import { TURN_EVENT, TURN_PHASE } from "@noobot/session-protocol";
import { ImmutableSessionStore } from "../../src/session/session-artifact-session/immutable-session-store.js";

const identity = { userId: "u1", sessionId: "s1", persistenceScope: null };

test("run context uses accepted authority facts without materializing message bodies", async (t) => {
  await withProvisionedSessions(
    { userId: "u1", sessionIds: ["s1"] },
    async ({ session, runtime, scopes }) => {
      const turnScopeId = "run-context-turn";
      const accepted = await session.applyTurnLifecycleEvent({
        ...identity,
        turnScopeId,
        presentationMessageId: "presentation-run-context",
        eventType: TURN_EVENT.ACTION_ACCEPTED,
        commandId: "accept-run-context",
        causationId: "accept-run-context",
        expectedRevision: 0,
        action: "send",
        phase: TURN_PHASE.ACTION,
        sessionCaller: "user",
        ...createAcceptedAgentExecution(turnScopeId, "s1"),
        userMessage: {
          content: "request",
          userMessageId: "um_run_context",
          messageOrigin: "natural",
        },
      });
      assert.equal(accepted.applied, true);
      const repo = runtime.repositories.sessionRepository;
      const full = await session.getSessionBundle(identity);
      await rm(scopes.s1.sessionFile, { force: true });
      const get = ImmutableSessionStore.prototype.get;
      t.mock.method(ImmutableSessionStore.prototype, "get", function (snapshot, collection, key) {
        assert.notEqual(collection, "messages", "run context must not read message bodies");
        return get.call(this, snapshot, collection, key);
      });
      repo.requireTurnView = () => {
        throw new Error("initialization must not materialize a turn view");
      };
      repo.findById = () => {
        throw new Error("initialization must not load full history");
      };
      const payload = { ...identity, turnScopeId, dialogProcessId: accepted.dialogProcessId };
      const context = await session.getSessionRunContext(payload);
      assert.deepEqual(context, {
        startedAt: full.session.turnLifecycle.turns[turnScopeId].startedAt,
        modelAlias: full.session.modelAlias,
        parentSessionId: "",
        sessionDir: scopes.s1.sessionDir,
      });
      await assert.rejects(
        session.getSessionRunContext({ ...payload, dialogProcessId: "wrong-dialog" }),
      );
      await assert.rejects(
        session.getSessionRunContext({ ...payload, turnScopeId: "missing-turn" }),
        { code: "TURN_LIFECYCLE_TURN_NOT_FOUND" },
      );
      await persistSessionDeletionMarkers(repo, "u1", ["s1"]);
      await assert.rejects(session.getSessionRunContext(payload), { code: "SESSION_DELETED" });
    },
  );
});
