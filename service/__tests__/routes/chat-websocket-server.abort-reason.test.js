/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import test from "node:test";
import assert from "node:assert/strict";
import { createTurnFinalizer } from "../../ws/chat-websocket/terminal-outcomes.js";
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
    sessionLogConfig: {},
    webSocket: { close() {} },
    commitTurnLifecycle: async (command) => {
      committed.push(command);
      return { applied: true, turnStatus: { status: "error" } };
    },
  });

  await finalizer.finalizeTimeout(
    {
      runMeta: {
        commandId: "command-timeout",
        commandType: AGENT_COMMAND.SEND,
        userId: "admin",
        sessionId: "session-timeout",
        turnScopeId: "turn-timeout",
        dialogProcessId: "dialog-timeout",
      },
      turnScopeId: "turn-timeout",
    },
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
