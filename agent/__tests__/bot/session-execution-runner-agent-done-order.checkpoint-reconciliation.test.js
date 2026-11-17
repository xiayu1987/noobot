/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import test from "node:test";
import { createTestMessagePersistenceReceipts } from "../helpers/message-persistence-receipts.js";
import { createTestRuntimeContext } from "../helpers/test-runtime-context.js";
import {
  assert,
  createRunner,
  finalizeAgentTurn,
} from "./session-execution-runner-agent-done-order.fixtures.js";
import { SESSION_CALLER } from "@noobot/shared/session-caller";

test("runSession reads the complete durable result only after flushing pending changes", async () => {
  const callOrder = [];
  let capturedFinalizePayload = null;
  const durableMessages = [
    {
      messageUid: "sm_assistant",
      modelMessageId: "message-assistant",
      role: "assistant",
      content: "already persisted",
      summarized: false,
      turnScopeId: "turn-a",
      dialogProcessId: "dialog-1",
    },
    {
      messageUid: "sm_tool",

      role: "tool",
      content: "tool result",
      summarized: false,
      turnScopeId: "turn-a",
      dialogProcessId: "dialog-1",
    },
  ];
  const runner = createRunner({
    callOrder,
    runtime: createTestRuntimeContext(),
    agentRunner: async () => ({
      output: "done",
      modelMessageId: "message-assistant",
      traces: [],
      turnMessages: durableMessages.map((message) => ({ ...message, summarized: true })),
      modelLoopRound: 0,
      modelMessages: [],
    }),
    getSessionTurns: async () => {
      callOrder.push("readResult");
      return durableMessages;
    },
    finalizeRunSession: async (payload = {}) => {
      capturedFinalizePayload = payload;
      assert.equal(callOrder.includes("readResult"), false);
      await payload.turnPersistence.flush();
      callOrder.push("flushed");
      payload.resultMessages = await payload.turnPersistence.readResultMessages();
      return { ok: true };
    },
  });

  await runner.runAcceptedSession({
    userId: "u1",
    sessionId: "s1",
    message: "hello",
    turnScopeId: "turn-a",
  });

  assert.deepEqual(capturedFinalizePayload.resultMessages, durableMessages);
  assert.ok(callOrder.indexOf("flushed") < callOrder.indexOf("readResult"));
});

test("runSession upserts summarized messages created after a checkpoint", async () => {
  const callOrder = [];
  let capturedFinalizePayload = null;
  const writes = [];
  const runtime = createTestRuntimeContext();
  const durableMessages = [
    {
      messageUid: "sm_checkpoint-tool",

      role: "tool",
      content: "checkpoint result",
      summarized: true,
      turnScopeId: "turn-a",
      dialogProcessId: "dialog-1",
    },
    {
      messageUid: "sm_tail-tool",

      role: "tool",
      content: "tail result",
      summarized: false,
      turnScopeId: "turn-a",
      dialogProcessId: "dialog-1",
    },
    {
      messageUid: "sm_final-assistant",
      modelMessageId: "message-final",
      role: "assistant",
      content: "done",
      summarized: false,
      turnScopeId: "turn-a",
      dialogProcessId: "dialog-1",
    },
  ];
  const runner = createRunner({
    callOrder,
    runtime,
    agentRunner: async () => {
      runtime.currentTurnMessages.replaceAll(durableMessages);
      await runtime.persistCurrentTurnMessages();
      writes.length = 0;
      for (const message of durableMessages)
        runtime.currentTurnMessages.updateByUid(message.messageUid, { summarized: true });
      return {
        output: "done",
        modelMessageId: "message-final",
        traces: [],
        turnMessages: durableMessages.map((message) => ({ ...message, summarized: true })),
        modelLoopRound: 0,
        modelMessages: [],
      };
    },
    appendAgentMessages: async ({ messages, ...identity }) => {
      writes.push(...messages);
      for (const message of messages) {
        const index = durableMessages.findIndex((item) => item.messageUid === message.messageUid);
        if (index === -1) durableMessages.push(message);
        else durableMessages[index] = { ...durableMessages[index], ...message };
      }
      return createTestMessagePersistenceReceipts({ messages, ...identity });
    },
    getSessionTurns: async () => durableMessages,
    finalizeRunSession: async (payload = {}) => {
      capturedFinalizePayload = payload;
      await payload.turnPersistence.flush();
      payload.resultMessages = await payload.turnPersistence.readResultMessages();
      return { ok: true };
    },
  });

  await runner.runAcceptedSession({
    userId: "u1",
    sessionId: "s1",
    message: "hello",
    turnScopeId: "turn-a",
  });

  assert.deepEqual(
    writes.map((message) => message.messageUid).sort(),
    ["sm_tail-tool", "sm_final-assistant"].sort(),
  );
  assert.deepEqual(
    capturedFinalizePayload.resultMessages.map((message) => [
      message.messageUid,
      message.summarized,
    ]),
    [
      ["sm_checkpoint-tool", true],
      ["sm_tail-tool", true],
      ["sm_final-assistant", true],
    ],
  );
});

test("runSession returns committed scope members independently of checkpoint UID caches", async () => {
  const callOrder = [];
  const runtime = createTestRuntimeContext();
  let capturedFinalizePayload = null;
  const runner = createRunner({
    callOrder,
    runtime,
    agentRunner: async () => ({
      output: "tail",
      modelMessageId: "message-tail",
      traces: [],
      turnMessages: [
        {
          messageUid: "sm_retained",
          role: "tool",
          content: "retained-persisted",
        },
        {
          modelMessageId: "message-tail",
          messageUid: "sm_tail",
          role: "assistant",
          content: "tail",
        },
      ],
      modelLoopRound: 0,
      modelMessages: [],
    }),
    getSessionTurns: async () => [
      {
        messageUid: "sm_first",
        role: "assistant",
        content: "persisted-1",
        turnScopeId: "turn-a",
        dialogProcessId: "dialog-1",
      },
      {
        messageUid: "sm_unrelated",
        role: "assistant",
        content: "inserted",
        turnScopeId: "turn-a",
        dialogProcessId: "dialog-1",
      },
      {
        messageUid: "sm_retained",
        role: "tool",
        content: "retained-persisted",
        turnScopeId: "turn-a",
        dialogProcessId: "dialog-1",
      },
    ],
    finalizeRunSession: async (payload = {}) => {
      capturedFinalizePayload = payload;
      await payload.turnPersistence.flush();
      payload.resultMessages = await payload.turnPersistence.readResultMessages();
      return { ok: true };
    },
  });

  await runner.runAcceptedSession({
    userId: "u1",
    sessionId: "s1",
    message: "hello",
    turnScopeId: "turn-a",
  });

  assert.deepEqual(
    capturedFinalizePayload.resultMessages.map((message) => message.messageUid),
    ["sm_first", "sm_unrelated", "sm_retained"],
  );
});

test("runSession recovers committed checkpoint messages without a runtime receipt cache", async () => {
  const callOrder = [];
  const runtime = createTestRuntimeContext();
  let capturedFinalizePayload = null;
  const runner = createRunner({
    callOrder,
    runtime,
    agentRunner: async () => ({
      output: "tail",
      modelMessageId: "message-tail",
      traces: [],
      turnMessages: [
        {
          messageUid: "sm_retained",
          role: "tool",
          content: "retained-persisted",
        },
        {
          modelMessageId: "message-tail",
          messageUid: "sm_tail",
          role: "assistant",
          content: "tail",
        },
      ],
      modelLoopRound: 0,
      modelMessages: [],
    }),
    getSessionTurns: async () => [
      {
        messageUid: "sm_first",
        role: "assistant",
        content: "persisted-1",
        turnScopeId: "turn-a",
        dialogProcessId: "dialog-1",
      },
      {
        messageUid: "sm_retained",
        role: "tool",
        content: "retained-persisted",
        turnScopeId: "turn-a",
        dialogProcessId: "dialog-1",
      },
    ],
    finalizeRunSession: async (payload = {}) => {
      capturedFinalizePayload = payload;
      await payload.turnPersistence.flush();
      payload.resultMessages = await payload.turnPersistence.readResultMessages();
      return { ok: true };
    },
  });

  await runner.runAcceptedSession({
    userId: "u1",
    sessionId: "s1",
    message: "hello",
    turnScopeId: "turn-a",
  });

  assert.deepEqual(
    capturedFinalizePayload.resultMessages.map((message) => message.messageUid),
    ["sm_first", "sm_retained"],
  );
});

test("finalizer preserves canonical activity from the timeline checkpoint", async () => {
  let capturedFinalizePayload = null;
  await finalizeAgentTurn({
    resolvedRunConfig: {},
    runtimeEventListener: null,
    usedSessionId: "s1",
    dialogProcessId: "dialog-1",
    resolvedTurnScopeId: "turn-a",
    dispatchRuntime: { async persistCurrentTurnMessages() {} },
    getSessionTurns: async () => [
      {
        messageUid: "sm_assistant",
        role: "assistant",
        type: "tool_call",
        turnScopeId: "turn-a",
        dialogProcessId: "dialog-1",
        activityTimeline: [{ eventId: "guidance-analysis:1" }],
      },
    ],
    finalizeRunSession: async (payload = {}) => {
      capturedFinalizePayload = payload;
      await payload.turnPersistence.flush();
      payload.resultMessages = await payload.turnPersistence.readResultMessages();
      return { ok: true };
    },
    userId: "u1",
    parentSessionId: "",
    parentDialogProcessId: "",
    caller: SESSION_CALLER.USER,
    agentResult: {
      turnMessages: [
        {
          messageUid: "sm_assistant",
          role: "assistant",
          type: "tool_call",
          activityTimeline: [],
        },
      ],
    },
    userConfig: {},
    lifecycle: null,
    persistenceContext: null,
  });

  assert.equal(capturedFinalizePayload.resultMessages.length, 1);
  assert.equal(
    capturedFinalizePayload.resultMessages[0].activityTimeline[0].eventId,
    "guidance-analysis:1",
  );
});
