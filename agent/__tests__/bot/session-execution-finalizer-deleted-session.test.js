/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import test from "node:test";
import assert from "node:assert/strict";

import { SESSION_CALLER } from "@noobot/shared/session-caller";
import { createAgentTurnResult } from "@noobot/agent-transport-protocol/agent-turn-result";
import { createMessageUid } from "@noobot/session-protocol/message-identity";
import { SessionExecutionFinalizer } from "../../src/bot/execution/finalizer.js";
import { SessionTurnPersister } from "../../src/bot/execution/turn-persister.js";
import { pathExists as exists, withProvisionedSessions } from "../helpers/provisioned-sessions.js";

const USER_ID = "u1";
const TARGET_SESSION_ID = "running-target";
const SIBLING_SESSION_ID = "running-sibling";

function withRunningSessions(fn) {
  return withProvisionedSessions(
    { userId: USER_ID, sessionIds: [TARGET_SESSION_ID, SIBLING_SESSION_ID] },
    fn,
  );
}

function createHarness(session) {
  const effects = [];
  const finalizer = new SessionExecutionFinalizer({
    session,
    turnPersister: new SessionTurnPersister({ session }),
    memoryPostProcessService: {
      resolveMemoryPostProcessAsyncEnabled: () => true,
      async runMemoryPostProcessFlow() {
        effects.push("memory");
      },
    },
    now: () => "2026-11-01T00:00:00.000Z",
  });
  const payload = {
    userId: USER_ID,
    sessionId: TARGET_SESSION_ID,
    parentSessionId: "",
    parentDialogProcessId: "",
    caller: SESSION_CALLER.USER,
    dialogProcessId: "dp-running",
    turnScopeId: "turn-running",
    thinkingStartedAt: "2026-11-01T00:00:00.000Z",
    agentResult: createAgentTurnResult({
      output: "late answer",
      traces: [],
      modelMessages: [],
      modelLoopRound: 1,
      turnMessages: [
        {
          messageUid: createMessageUid(),
          modelMessageId: "message-running-assistant",
          presentationMessageId: "presentation-running",
          role: "assistant",
          type: "message",
          content: "late answer",
        },
      ],
    }),
    persistedTurnMessageUids: [],
    persistedTurnMessages: [],
    durableTurnMessages: [],
    summaryCheckpointPromotionSources: [],
    runtimeEventListener: { onEvent() {}, async flush() {} },
    userConfig: {},
    lifecycle: {
      enterPersisting: () => effects.push("persisting"),
      enterMemory: () => effects.push("memory-stage"),
    },
    persistenceScope: null,
  };
  return { finalizer, payload, effects };
}

async function assertDeletedWithoutResidue({ session, scopes, effects }) {
  assert.equal(effects.includes("memory-stage"), false);
  assert.equal(effects.includes("memory"), false);
  assert.equal(await exists(scopes[TARGET_SESSION_ID].sessionDir), false);
  await assert.rejects(
    session.getSessionTurns({
      userId: USER_ID,
      sessionId: TARGET_SESSION_ID,
      persistenceScope: null,
    }),
    { code: "SESSION_DELETED" },
  );
  assert.equal(await exists(scopes[SIBLING_SESSION_ID].sessionFile), true);
  assert.deepEqual(
    await session.getSessionTurns({
      userId: USER_ID,
      sessionId: SIBLING_SESSION_ID,
      persistenceScope: null,
    }),
    [],
  );
}

test("a session deleted while the agent runs rejects final persistence without recreating it", async () => {
  await withRunningSessions(async ({ session, scopes }) => {
    const { finalizer, payload, effects } = createHarness(session);
    await session.deleteSessionBranch({ userId: USER_ID, sessionIds: [TARGET_SESSION_ID] });

    await assert.rejects(finalizer.finalizeRunSession(payload), {
      code: "SESSION_DELETED",
      statusCode: 410,
    });

    assert.deepEqual(effects, ["persisting"]);
    await assertDeletedWithoutResidue({ session, scopes, effects });
  });
});

test("a session deleted between message persistence and turn timing rejects the timing write", async () => {
  await withRunningSessions(async ({ session, scopes }) => {
    const appendedTurns = [];
    const racingSession = {
      ...session,
      async appendTurns(input) {
        const result = await session.appendTurns(input);
        appendedTurns.push(...result.turns);
        await session.deleteSessionBranch({ userId: USER_ID, sessionIds: [TARGET_SESSION_ID] });
        return result;
      },
    };
    const { finalizer, payload, effects } = createHarness(racingSession);

    await assert.rejects(finalizer.finalizeRunSession(payload), {
      code: "SESSION_DELETED",
      statusCode: 410,
    });

    assert.equal(appendedTurns.length, 1);
    assert.deepEqual(effects, ["persisting"]);
    await assertDeletedWithoutResidue({ session, scopes, effects });
  });
});
