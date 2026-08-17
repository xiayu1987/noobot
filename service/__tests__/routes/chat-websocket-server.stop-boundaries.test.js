/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import test from "node:test";
import assert from "node:assert/strict";
import { WebSocket } from "ws";
import { startServerWithWs, closeServer, callChatWs, createProtocolTestCommand } from "./chat-websocket-server.test-helpers.js";
import { TURN_EVENT } from "@noobot/session-protocol";
import {
  AGENT_COMMAND_RECEIPT_OUTCOME,
  AGENT_TRANSPORT_EVENT,
} from "@noobot/agent-transport-protocol";

test("chat-websocket-server: non-user abort emits only authoritative failure and failed receipt", async () => {
  const server = await startServerWithWs({
    bot: {
      runSession: async () => {
        const error = new Error("upstream aborted unexpectedly");
        error.name = "AbortError";
        throw error;
      },
    },
  });
  try {
    const { port } = server.address();
    const events = await callChatWs({
      port,
      payload: {
        userId: "u1",
        sessionId: "s-non-user-abort",
        message: "hello",
        turnScopeId: "turn-non-user-abort",
        config: { locale: "zh-CN" },
      },
    });

    const failedLifecycle = events.find(
      (item) =>
        item?.event === "turn_lifecycle" &&
        item?.data?.payload?.eventType === TURN_EVENT.FAILED,
    );
    assert.equal(failedLifecycle?.data?.identity?.turnScopeId, "turn-non-user-abort");
    const failedReceipt = events.find(
      (item) =>
        item?.event === AGENT_TRANSPORT_EVENT.COMMAND_RECEIPT &&
        item?.data?.outcome === AGENT_COMMAND_RECEIPT_OUTCOME.FAILED,
    );
    assert.match(String(failedReceipt?.data?.error?.message || ""), /upstream aborted unexpectedly/);
  } finally {
    await closeServer(server);
  }
});

test("chat-websocket-server: client disconnect aborts execution without persisting run_aborted", async () => {
  let terminalStatusWrites = 0;
  let runAborted = false;
  const server = await startServerWithWs({
    bot: {
      upsertTurnStatus: async () => {
        terminalStatusWrites += 1;
        return null;
      },
      runSession: async ({ abortSignal }) => new Promise((resolve, reject) => {
        abortSignal.addEventListener("abort", () => {
          runAborted = true;
          const error = new Error("execution aborted after socket close");
          error.name = "AbortError";
          reject(error);
        }, { once: true });
      }),
    },
  });
  try {
    const { port } = server.address();
    const ws = new WebSocket(`ws://localhost:${port}/chat/ws`, {
      headers: { authorization: "Bearer test-key" },
    });
    await new Promise((resolve, reject) => {
      ws.on("open", () => {
        ws.send(JSON.stringify(createProtocolTestCommand({
          userId: "u1",
          sessionId: "s-client-disconnect",
          message: "hello",
          turnScopeId: "turn-client-disconnect",
        })));
        setTimeout(() => ws.close(1000, "dispose"), 10);
      });
      ws.on("close", resolve);
      ws.on("error", reject);
    });
    await new Promise((resolve) => setTimeout(resolve, 20));

    assert.equal(runAborted, true);
    assert.equal(terminalStatusWrites, 0);
  } finally {
    await closeServer(server);
  }
});

test("chat-websocket-server: request userId cannot override the authenticated owner", async () => {
  let runCalls = 0;
  let turnStatusWrites = 0;
  const server = await startServerWithWs({
    bot: {
      runSession: async () => {
        runCalls += 1;
        return {};
      },
      upsertTurnStatus: async () => {
        turnStatusWrites += 1;
        return null;
      },
    },
    resolveAuthByApiKey: () => ({ userId: "authenticated-user" }),
  });
  try {
    const { port } = server.address();
    const events = await callChatWs({
      port,
      payload: {
        userId: "forbidden-user",
        sessionId: "s-forbidden",
        message: "hello",
        turnScopeId: "turn-forbidden",
        config: { locale: "zh-CN" },
      },
    });

    assert.equal(runCalls, 1);
    assert.equal(turnStatusWrites, 0);
    assert.equal(
      events.some(
        (item) =>
          item?.event === "turn_lifecycle" &&
          item?.data?.payload?.eventType === TURN_EVENT.COMPLETED,
      ),
      true,
    );
    assert.equal(
      events.some(
        (item) =>
          item?.event === AGENT_TRANSPORT_EVENT.COMMAND_RECEIPT &&
          item?.data?.outcome === AGENT_COMMAND_RECEIPT_OUTCOME.FAILED,
      ),
      false,
    );
  } finally {
    await closeServer(server);
  }
});
