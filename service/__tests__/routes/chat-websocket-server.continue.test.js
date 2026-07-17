/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import test from "node:test";
import assert from "node:assert/strict";
import { startServerWithWs, closeServer, callChatWs, stopChatWs } from "./chat-websocket-server.test-helpers.js";

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
        userId: "u1",
        sessionId: "s1",
        message: "全仓回归测试",
        turnScopeId: " client-turn:resend ",
        config: { locale: "zh-CN", reuseExistingUserTurn: true },
      },
    });

    assert.equal(capturedPayload?.runConfig?.turnScopeId, "client-turn:resend");
    assert.equal(capturedPayload?.runConfig?.reuseExistingUserTurn, true);
  } finally {
    await closeServer(server);
  }
});

test("chat-websocket-server: continue action passes stopped snapshot identity and emits sending", async () => {
  let capturedPayload = null;
  const server = await startServerWithWs({
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
    const sendingEvent = events.find((item) => item?.event === "channel_state" && item?.data?.state === "sending");
    assert.equal(sendingEvent?.data?.sourceEvent, "continue_started");
    assert.equal(sendingEvent?.data?.dialogProcessId || "", "");
    assert.equal(sendingEvent?.data?.resumeDialogProcessId, "dp-stopped");
    assert.equal(sendingEvent?.data?.resumeTurnScopeId, "turn-stopped");
    assert.equal(sendingEvent?.data?.turnScopeId, "turn-new");
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
    const errorEvent = events.find((item) => item?.event === "error");
    assert.match(String(errorEvent?.data?.error || ""), /continue requires resumeDialogProcessId and resumeTurnScopeId/);
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
    const errorEvent = events.find((item) => item?.event === "error");
    assert.match(String(errorEvent?.data?.error || ""), /continue requires resumeDialogProcessId and resumeTurnScopeId/);
    assert.equal(runSessionCalled, false);
    assert.equal(turnStatusWrites, 0);
  } finally {
    await closeServer(server);
  }
});

test("chat-websocket-server: stop during continue request keeps stopping and ends user_stopped", async () => {
  let capturedStopPayload = null;
  const server = await startServerWithWs({
    bot: {
      persistStoppedAssistantMessage: async (payload = {}) => {
        capturedStopPayload = payload;
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
        config: { locale: "zh-CN", resumeDialogProcessId: "dp-stopped", resumeTurnScopeId: "turn-stopped" },
      },
      stopPayload: {
        sessionId: "s-continue-stop",
        turnScopeId: "turn-new",
        dialogProcessId: "dp-stopped",
        partialAssistant: { content: "partial", dialogProcessId: "dp-new", turnScopeId: "turn-new" },
      },
    });

    assert.equal(events.some((item) => item?.event === "channel_state" && item?.data?.state === "stopping"), true);
    const stoppedEvent = events.find((item) => item?.event === "user_stopped");
    assert.equal(stoppedEvent?.data?.sessionId, "s-continue-stop");
    assert.equal(stoppedEvent?.data?.turnScopeId, "turn-new");
    assert.equal(capturedStopPayload?.partialAssistant?.turnScopeId, "turn-new");
  } finally {
    await closeServer(server);
  }
});
