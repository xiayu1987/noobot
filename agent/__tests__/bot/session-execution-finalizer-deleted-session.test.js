/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";

import { SESSION_CALLER } from "@noobot/shared/session-caller";
import { createAgentTurnResult } from "@noobot/agent-transport-protocol/agent-turn-result";
import { createMessageUid } from "@noobot/session-protocol/message-identity";
import { SessionExecutionFinalizer } from "../../src/bot/execution/finalizer.js";
import { SessionTurnPersister } from "../../src/bot/execution/turn-persister.js";
import { bindCurrentTurnPersistence } from "../../src/bot/execution/runner/current-turn-persistence.js";
import { createCurrentTurnMessagesStore } from "../../src/runtime/turn/current-turn-ledger.js";
import { pathExists as exists, withProvisionedSessions } from "../helpers/provisioned-sessions.js";
import { executeEmptySessionCleanup, testWallClock } from "../helpers/session-services.js";

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
    startedAt: "2026-11-01T00:00:00.000Z",
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
    runtimeEventListener: { onEvent() {}, async flush() {} },
    userConfig: {},
    lifecycle: {
      enterPersisting: () => effects.push("persisting"),
      enterMemory: () => effects.push("memory-stage"),
    },
    persistenceScope: null,
  };
  const dispatchRuntime = {
    currentTurnMessages: createCurrentTurnMessagesStore(payload.agentResult.turnMessages),
  };
  const persister = new SessionTurnPersister({ session, now: testWallClock });
  bindCurrentTurnPersistence({
    dispatchRuntime,
    appendAgentMessages: (input) => persister.appendAgentMessages(input),
    commitSummaryCheckpoint: async () => {},
    userId: USER_ID,
    sessionId: TARGET_SESSION_ID,
    dialogProcessId: payload.dialogProcessId,
    parentDialogProcessId: "",
    turnScopeId: payload.turnScopeId,
    eventListener: payload.runtimeEventListener,
    persistenceScope: null,
  });
  payload.turnPersistence = {
    flush: () => dispatchRuntime.persistCurrentTurnMessages(),
    readResultTransfers: () => [],
  };
  return { finalizer, payload, effects };
}

async function assertDeletedWithoutResidue({ session, scopes, effects }) {
  assert.equal(effects.includes("memory-stage"), false);
  assert.equal(effects.includes("memory"), false);
  assert.equal(await exists(scopes[TARGET_SESSION_ID].sessionDir), false);
  const query = {
    userId: USER_ID,
    dialogProcessId: "dp-running",
    turnScopeId: "turn-running",
    cursor: null,
    limit: 1,
    persistenceScope: null,
  };
  await assert.rejects(
    session.getSessionTurnMessagePage({
      ...query,
      sessionId: TARGET_SESSION_ID,
    }),
    { code: "SESSION_DELETED" },
  );
  assert.equal(await exists(path.join(scopes[SIBLING_SESSION_ID].sessionDir, "head.json")), true);
  assert.deepEqual(
    await session.getSessionTurnMessagePage({
      ...query,
      sessionId: SIBLING_SESSION_ID,
    }),
    null,
  );
}

test("a session deleted while the agent runs rejects final persistence without recreating it", async () => {
  await withRunningSessions(async ({ session, scopes }) => {
    const { finalizer, payload, effects } = createHarness(session);
    await session.deleteSessionBranch(
      { userId: USER_ID, sessionIds: [TARGET_SESSION_ID] },
      executeEmptySessionCleanup,
    );

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
        appendedTurns.push(...result.messageReceipts);
        await session.deleteSessionBranch(
          { userId: USER_ID, sessionIds: [TARGET_SESSION_ID] },
          executeEmptySessionCleanup,
        );
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
