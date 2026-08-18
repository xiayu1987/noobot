/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import test from "node:test";
import assert from "node:assert/strict";
import {
  startServerWithWs,
  closeServer,
  callChatWs,
  stopChatWs,
} from "./chat-websocket-server.test-helpers.js";
import { TURN_EVENT } from "@noobot/session-protocol";
import {
  AGENT_COMMAND_RECEIPT_OUTCOME,
  AGENT_TRANSPORT_EVENT,
} from "@noobot/agent-transport-protocol";

function stoppedLifecycle({
  sessionId = "s1",
  turnScopeId = "turn-stopped",
  dialogProcessId = "dp-stopped",
} = {}) {
  return {
    sequence: 5,
    activeTurnScopeId: "",
    turns: {
      [turnScopeId]: {
        sessionId,
        turnScopeId,
        dialogProcessId,
        messageId: `message-${turnScopeId}`,
        presentationMessageId: `presentation-${turnScopeId}`,
        action: "stop",
        state: "stop_completed",
        phase: "stop",
        executionState: "user_stopped",
        revision: 5,
        sequence: 5,
      },
    },
  };
}

test("chat-websocket-server: edit resend turnScopeId reaches runConfig", async () => {
  let capturedPayload = null;
  const server = await startServerWithWs({
    runSession: async (payload) => {
      capturedPayload = payload;
      return {
        sessionId: "s1",
        dialogProcessId: "dp-1",
        answer: "done",
        messages: [],
        traces: [],
        executionLogs: [],
      };
    },
  });
  try {
    const { port } = server.address();
    await callChatWs({
      port,
      payload: {
        commandType: "turn.resend",
        sessionId: "s1",
        dialogProcessId: "dp-resend",
        message: "全仓回归测试",
        turnScopeId: " client-turn:resend ",
        config: { locale: "zh-CN" },
      },
    });

    assert.equal(capturedPayload?.runConfig?.turnScopeId, "client-turn:resend");
    assert.equal(capturedPayload?.runConfig?.reuseExistingUserTurn, true);
    assert.equal(capturedPayload?.dialogProcessId, "dp-resend");
  } finally {
    await closeServer(server);
  }
});

test("chat-websocket-server: continue action passes stopped snapshot identity through authoritative lifecycle", async () => {
  let capturedPayload = null;
  const server = await startServerWithWs({
    initialTurnLifecycle: stoppedLifecycle(),
    runSession: async (payload) => {
      capturedPayload = payload;
      return {
        sessionId: "s1",
        dialogProcessId: "dp-new",
        answer: "continued",
        messages: [],
        traces: [],
        executionLogs: [],
      };
    },
  });
  try {
    const { port } = server.address();
    const events = await callChatWs({
      port,
      payload: {
        action: "continue",
        userId: "u1",
        sessionId: "s1",
        message: "continue",
        turnScopeId: "turn-new",
        config: {
          locale: "zh-CN",
          resumeDialogProcessId: "dp-stopped",
          resumeTurnScopeId: "turn-stopped",
          selectedModel: "main",
        },
      },
    });

    assert.equal(capturedPayload?.runConfig?.resumeFromStoppedSnapshot, true);
    assert.equal(capturedPayload?.runConfig?.resumeDialogProcessId, "dp-stopped");
    assert.equal(capturedPayload?.runConfig?.resumeTurnScopeId, "turn-stopped");
    assert.equal(capturedPayload?.runConfig?.turnScopeId, "turn-new");
    const acceptedEvent = events.find(
      (item) =>
        item?.event === "turn_lifecycle" &&
        item?.data?.payload?.eventType === TURN_EVENT.ACTION_ACCEPTED,
    );
    assert.equal(acceptedEvent?.data?.identity?.sessionId, "s1");
    assert.equal(acceptedEvent?.data?.identity?.turnScopeId, "turn-new");
    assert.equal(acceptedEvent?.data?.payload?.action, "continue");
    assert.deepEqual(acceptedEvent?.data?.payload?.continuationSource, {
      dialogProcessId: "dp-stopped",
      turnScopeId: "turn-stopped",
    });
    assert.equal(
      events.some((item) => item?.event === "channel_state"),
      false,
    );
  } finally {
    await closeServer(server);
  }
});

test("chat-websocket-server: a consumed stopped source is rejected before a second Agent run", async () => {
  let runSessionCalls = 0;
  const server = await startServerWithWs({
    initialTurnLifecycle: stoppedLifecycle(),
    runSession: async () => {
      runSessionCalls += 1;
      return {
        sessionId: "s1",
        dialogProcessId: "dp-new",
        answer: "continued",
        messages: [],
        traces: [],
        executionLogs: [],
      };
    },
  });
  try {
    const { port } = server.address();
    const continuePayload = {
      action: "continue",
      userId: "u1",
      sessionId: "s1",
      message: "continue",
      config: {
        resumeDialogProcessId: "dp-stopped",
        resumeTurnScopeId: "turn-stopped",
      },
    };
    await callChatWs({ port, payload: { ...continuePayload, turnScopeId: "turn-new" } });
    const rejectedEvents = await callChatWs({
      port,
      payload: { ...continuePayload, turnScopeId: "turn-new-2" },
    });

    assert.equal(runSessionCalls, 1);
    const receipt = rejectedEvents.find(
      (item) => item?.event === AGENT_TRANSPORT_EVENT.COMMAND_RECEIPT,
    )?.data;
    assert.equal(receipt?.outcome, AGENT_COMMAND_RECEIPT_OUTCOME.FAILED);
    assert.equal(receipt?.error?.code, "continue_source_consumed");
    assert.equal(
      rejectedEvents.some(
        (item) =>
          item?.event === "turn_lifecycle" &&
          item?.data?.identity?.turnScopeId === "turn-new-2" &&
          item?.data?.payload?.eventType === TURN_EVENT.ACTION_ACCEPTED,
      ),
      false,
    );
  } finally {
    await closeServer(server);
  }
});

test("chat-websocket-server: continue action requires stopped dialogProcessId and turnScopeId", async () => {
  let turnStatusWrites = 0;
  const server = await startServerWithWs({
    bot: {
      runSession: async () => ({}),
      upsertTurnStatus: async () => {
        turnStatusWrites += 1;
        return null;
      },
    },
  });
  try {
    const { port } = server.address();
    const events = await callChatWs({
      port,
      payload: {
        action: "continue",
        userId: "u1",
        sessionId: "s1",
        message: "continue",
        turnScopeId: "turn-new",
        config: { locale: "zh-CN" },
      },
    });
    const receipt = events.find(
      (item) => item?.event === AGENT_TRANSPORT_EVENT.COMMAND_RECEIPT,
    )?.data;
    assert.equal(receipt?.outcome, AGENT_COMMAND_RECEIPT_OUTCOME.FAILED);
    assert.equal(receipt?.error?.code, "missing_continuation_dialog_process_id");
    assert.equal(turnStatusWrites, 0);
  } finally {
    await closeServer(server);
  }
});

test("chat-websocket-server: continue action does not fallback to current dialogProcessId", async () => {
  let runSessionCalled = false;
  let turnStatusWrites = 0;
  const server = await startServerWithWs({
    bot: {
      runSession: async () => {
        runSessionCalled = true;
        return { sessionId: "s1", dialogProcessId: "dp-current", answer: "unexpected" };
      },
      upsertTurnStatus: async () => {
        turnStatusWrites += 1;
        return null;
      },
    },
  });
  try {
    const { port } = server.address();
    const events = await callChatWs({
      port,
      payload: {
        action: "continue",
        userId: "u1",
        sessionId: "s1",
        dialogProcessId: "dp-current",
        message: "continue",
        turnScopeId: "turn-new",
        config: { locale: "zh-CN", resumeTurnScopeId: "turn-stopped" },
      },
    });
    const receipt = events.find(
      (item) => item?.event === AGENT_TRANSPORT_EVENT.COMMAND_RECEIPT,
    )?.data;
    assert.equal(receipt?.outcome, AGENT_COMMAND_RECEIPT_OUTCOME.FAILED);
    assert.equal(receipt?.error?.code, "missing_continuation_dialog_process_id");
    assert.equal(runSessionCalled, false);
    assert.equal(turnStatusWrites, 0);
  } finally {
    await closeServer(server);
  }
});

test("chat-websocket-server: stop during continue request ends with authoritative stop completion", async () => {
  let capturedStopPayload = null;
  const server = await startServerWithWs({
    initialTurnLifecycle: stoppedLifecycle({ sessionId: "s-continue-stop" }),
    bot: {
      materializeTerminalMessages: ({ event, terminalStatus, previousSummaryVersion }) => {
        capturedStopPayload = { event, terminalStatus };
        return {
          materialized: true,
          terminalStatus,
          messages: [],
          summaryVersion: previousSummaryVersion + 1,
        };
      },
      runSession: async ({ abortSignal }) => {
        await new Promise((resolve) => {
          if (abortSignal?.aborted) return resolve();
          abortSignal?.addEventListener?.("abort", resolve, { once: true });
        });
        const error = new Error("continue aborted");
        error.name = "AbortError";
        throw error;
      },
    },
  });
  try {
    const { port } = server.address();
    const events = await stopChatWs({
      port,
      payload: {
        action: "continue",
        userId: "u1",
        sessionId: "s-continue-stop",
        dialogProcessId: "dp-stopped",
        message: "continue",
        turnScopeId: "turn-new",
        config: {
          locale: "zh-CN",
          resumeDialogProcessId: "dp-stopped",
          resumeTurnScopeId: "turn-stopped",
        },
      },
      stopPayload: {
        sessionId: "s-continue-stop",
        turnScopeId: "turn-new",
        dialogProcessId: "dp-stopped",
        partialAssistant: {
          content: "partial",
          dialogProcessId: "dp-new",
          turnScopeId: "turn-new",
        },
      },
    });

    assert.equal(
      events.some(
        (item) =>
          item?.event === "turn_lifecycle" &&
          item?.data?.payload?.eventType === TURN_EVENT.STOP_ACCEPTED &&
          item?.data?.identity?.turnScopeId === "turn-new",
      ),
      true,
    );
    assert.equal(
      events.some((item) => item?.event === "channel_state"),
      false,
    );
    const stoppedEvent = events.find(
      (item) =>
        item?.event === "turn_lifecycle" &&
        item?.data?.payload?.eventType === TURN_EVENT.STOP_COMPLETED,
    );
    assert.equal(stoppedEvent?.data?.identity?.sessionId, "s-continue-stop");
    assert.equal(stoppedEvent?.data?.identity?.turnScopeId, "turn-new");
    assert.equal(stoppedEvent?.data?.payload?.dialogProcessId, "dp-new");
    assert.equal(stoppedEvent?.data?.payload?.phase, "stop");
    assert.equal(stoppedEvent?.data?.payload?.state, "stop_completed");
    assert.ok(stoppedEvent?.data?.identity?.eventId);
    assert.equal(
      capturedStopPayload?.event?.terminalStatus?.assistantMessage?.turnScopeId,
      "turn-new",
    );
    assert.equal(
      capturedStopPayload?.event?.terminalStatus?.assistantMessage?.dialogProcessId,
      "dp-new",
    );
  } finally {
    await closeServer(server);
  }
});
