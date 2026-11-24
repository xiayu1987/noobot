/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { executeEmptySessionCleanup } from "../helpers/session-services.js";
import test from "node:test";
import assert from "node:assert/strict";

import { SESSION_CALLER } from "@noobot/shared/session-caller";
import {
  SESSION_DELETED_REASON,
  TURN_EVENT,
  TURN_PHASE,
  TURN_STATE,
} from "@noobot/session-protocol";
import { createAcceptedAgentExecution } from "../helpers/accepted-run-identity.js";
import { pathExists, withProvisionedSessions } from "../helpers/provisioned-sessions.js";

const USER_ID = "u1";
const TARGET_SESSION_ID = "lifecycle-target";
const SIBLING_SESSION_ID = "lifecycle-sibling";
const TURN_SCOPE_ID = "turn-running";

function acceptedEvent(sessionId) {
  return {
    userId: USER_ID,
    sessionId,
    persistenceScope: null,
    turnScopeId: TURN_SCOPE_ID,
    sessionCaller: SESSION_CALLER.USER,
    presentationMessageId: `presentation-${TURN_SCOPE_ID}`,
    eventType: TURN_EVENT.ACTION_ACCEPTED,
    commandId: `accept-${sessionId}`,
    causationId: `accept-${sessionId}`,
    expectedRevision: 0,
    action: "send",
    phase: TURN_PHASE.ACTION,
    ...createAcceptedAgentExecution(TURN_SCOPE_ID, sessionId),
    userMessage: {
      content: "running request",
      userMessageId: `um_${TURN_SCOPE_ID}`,
      messageOrigin: "natural",
    },
  };
}

function processingEvent(sessionId, dialogProcessId) {
  return {
    userId: USER_ID,
    sessionId,
    persistenceScope: null,
    turnScopeId: TURN_SCOPE_ID,
    dialogProcessId,
    presentationMessageId: `presentation-${TURN_SCOPE_ID}`,
    eventType: TURN_EVENT.PROCESSING_STARTED,
    commandId: `process-${sessionId}`,
    causationId: `process-${sessionId}`,
    expectedRevision: 1,
    phase: TURN_PHASE.PROCESSING,
  };
}

test("a session deleted during a running turn rejects later lifecycle commits without residue", async () => {
  const sessionIds = [TARGET_SESSION_ID, SIBLING_SESSION_ID];
  await withProvisionedSessions(
    { userId: USER_ID, sessionIds },
    async ({ runtime, session, scopes }) => {
      const target = await session.applyTurnLifecycleEvent(acceptedEvent(TARGET_SESSION_ID));
      const sibling = await session.applyTurnLifecycleEvent(acceptedEvent(SIBLING_SESSION_ID));
      assert.equal(target.applied, true);
      assert.equal(sibling.applied, true);

      await session.deleteSessionBranch(
        { userId: USER_ID, sessionIds: [TARGET_SESSION_ID] },
        executeEmptySessionCleanup,
      );

      const rejected = await session.applyTurnLifecycleEvent(
        processingEvent(TARGET_SESSION_ID, target.dialogProcessId),
      );
      assert.deepEqual(rejected, { applied: false, reason: SESSION_DELETED_REASON });
      assert.equal(await pathExists(scopes[TARGET_SESSION_ID].sessionDir), false);
      await assert.rejects(
        session.getSessionTurnMessagePage({
          userId: USER_ID,
          sessionId: TARGET_SESSION_ID,
          dialogProcessId: target.dialogProcessId,
          turnScopeId: TURN_SCOPE_ID,
          cursor: null,
          limit: 1,
          persistenceScope: null,
        }),
        { code: "SESSION_DELETED" },
      );

      const repository = runtime.repositories.sessionRepository;
      const options = {
        persistenceContext: repository.treePersistenceContext(USER_ID, SIBLING_SESSION_ID),
      };
      const query = { consumerId: "test", limit: 2 };
      await using before = await repository.requireSessionReader(
        USER_ID,
        SIBLING_SESSION_ID,
        options,
      );
      const siblingOutboxBefore = await before.readOutboxPage(query);
      const processed = await session.applyTurnLifecycleEvent(
        processingEvent(SIBLING_SESSION_ID, sibling.dialogProcessId),
      );
      assert.equal(processed.applied, true);
      assert.equal(processed.turn.state, TURN_STATE.PROCESSING);
      await using after = await repository.requireSessionReader(
        USER_ID,
        SIBLING_SESSION_ID,
        options,
      );
      const siblingOutboxAfter = await after.readOutboxPage(query);
      assert.equal(siblingOutboxAfter.events.length, siblingOutboxBefore.events.length + 1);
      assert.equal(siblingOutboxAfter.events.at(-1).eventId, processed.envelope.identity.eventId);
      assert.deepEqual(await before.readOutboxPage(query), siblingOutboxBefore);
    },
  );
});
