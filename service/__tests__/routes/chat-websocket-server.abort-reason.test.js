/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import test from "node:test";
import assert from "node:assert/strict";
import {
  createTurnFinalizer,
  snapshotRunState,
} from "../../ws/chat-websocket/terminal-outcomes.js";
import { buildAbortErrorMessage } from "../../ws/chat-websocket/stop-lifecycle.js";
import {
  AGENT_COMMAND,
  AGENT_COMMAND_RECEIPT_OUTCOME,
  AGENT_TRANSPORT_EVENT,
} from "@noobot/agent-transport-protocol";

test("service abort display uses the structured signal reason", () => {
  const controller = new AbortController();
  controller.abort({
    type: "run_timeout",
    reason: "run timeout after 18000000ms",
    timeoutMs: 18000000,
  });
  const error = new Error("Request was aborted.");
  error.name = "AbortError";

  assert.equal(
    buildAbortErrorMessage({ error, abortSignal: controller.signal }),
    "run timeout after 18000000ms",
  );
});

test("timeout finalization exposes the canonical timeout error code", async () => {
  const sent = [];
  const committed = [];
  const finalizer = createTurnFinalizer({
    sendEvent: (event, data) => sent.push({ event, data }),
    rejectUnpersistedTurnStatus: () => assert.fail("timeout status must persist"),
    translateText: (key) => key,
    webSocket: { close() {} },
    commitTurnLifecycle: async (command) => {
      committed.push(command);
      return { applied: true, turnStatus: { status: "error" } };
    },
  });

  await finalizer.finalizeTimeout(
    snapshotRunState({
      runMeta: {
        commandId: "command-timeout",
        commandType: AGENT_COMMAND.SEND,
        userId: "admin",
        sessionId: "session-timeout",
        turnScopeId: "turn-timeout",
        dialogProcessId: "dialog-timeout",
      },
    }),
    {
      description: "run timeout after 18000000ms",
      errorObject: { message: "run timeout after 18000000ms", code: "run_timeout" },
    },
  );

  assert.equal(committed[0]?.failure?.code, "run_timeout");
  assert.equal(committed[0]?.failure?.message, "run timeout after 18000000ms");
  const receipt = sent.at(-1);
  assert.equal(receipt?.event, AGENT_TRANSPORT_EVENT.COMMAND_RECEIPT);
  assert.equal(receipt?.data?.commandId, "command-timeout");
  assert.equal(receipt?.data?.commandType, AGENT_COMMAND.SEND);
  assert.equal(receipt?.data?.outcome, AGENT_COMMAND_RECEIPT_OUTCOME.FAILED);
  assert.equal(receipt?.data?.error?.code, "run_timeout");
  assert.equal(receipt?.data?.error?.message, "run timeout after 18000000ms");
});

test("run state snapshot resolves identity only from runMeta", () => {
  assert.throws(() => snapshotRunState({ runMeta: null }), /run_state_snapshot_requires_run_meta/);
  const bound = snapshotRunState({
    runMeta: { commandId: "cmd-1", userId: "u", sessionId: "s", turnScopeId: "turn-run" },
  }).identity;
  assert.equal(bound.turnScopeId, "turn-run");
  assert.equal(bound.sessionId, "s");
});

test("timeout finalization derives the lifecycle command from the turn scope", async () => {
  const committed = [];
  const finalizer = createTurnFinalizer({
    sendEvent: () => {},
    rejectUnpersistedTurnStatus: () => assert.fail("timeout status must persist"),
    translateText: (key) => key,
    webSocket: { close() {} },
    commitTurnLifecycle: async (command) => {
      committed.push(command);
      return { applied: true };
    },
  });
  await finalizer.finalizeTimeout(
    snapshotRunState({
      runMeta: {
        commandId: "turn-run",
        commandType: AGENT_COMMAND.SEND,
        sessionId: "s",
        turnScopeId: "turn-run",
      },
    }),
    { description: "timeout" },
  );
  assert.equal(committed[0].commandId.startsWith("turn-run:"), true);
  assert.equal(committed[0].turnScopeId, "turn-run");
});

test("user stop finalization reads the stop payload only from the abort reason", async () => {
  const finalizer = createTurnFinalizer({
    sendEvent: () => {},
    rejectUnpersistedTurnStatus: () => assert.fail("unexpected rejection"),
    translateText: (key) => key,
    webSocket: { close() {} },
    commitTurnLifecycle: async () => ({ applied: true }),
  });
  const controller = new AbortController();
  controller.abort({ type: "run_timeout", reason: "run timeout" });
  await assert.rejects(
    finalizer.finalizeUserStopped(
      snapshotRunState({ runMeta: { turnScopeId: "t" }, abortSignal: controller.signal }),
    ),
    /user_stop abort reason/,
  );
});

test("completion finalization requires the accepted commandId", async () => {
  const finalizer = createTurnFinalizer({
    sendEvent: () => {},
    rejectUnpersistedTurnStatus: () => {},
    translateText: (key) => key,
    webSocket: { close() {} },
    commitTurnLifecycle: async () => assert.fail("must not commit without commandId"),
  });
  await assert.rejects(
    finalizer.finalizeCompleted(snapshotRunState({ runMeta: { turnScopeId: "t" } })),
    /accepted commandId/,
  );
});
