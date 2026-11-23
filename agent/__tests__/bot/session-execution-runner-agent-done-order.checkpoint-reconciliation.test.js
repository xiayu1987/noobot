/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import test from "node:test";
import { createTestMessagePersistenceReceipts } from "../helpers/message-persistence-receipts.js";
import { createTestRuntimeContext } from "../helpers/test-runtime-context.js";
import { assert, createRunner } from "./session-execution-runner-agent-done-order.fixtures.js";

test("runSession flushes pending changes before returning transfers without reading durable history", async () => {
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
      assert.fail("finalization must not load durable history");
    },
    finalizeRunSession: async (payload = {}) => {
      capturedFinalizePayload = payload;
      assert.equal(callOrder.includes("readResult"), false);
      await payload.turnPersistence.flush();
      callOrder.push("flushed");
      payload.resultTransfers = await payload.turnPersistence.readResultTransfers();
      return { ok: true };
    },
  });

  await runner.runAcceptedSession({
    userId: "u1",
    sessionId: "s1",
    message: "hello",
    turnScopeId: "turn-a",
  });

  assert.deepEqual(capturedFinalizePayload.resultTransfers, []);
  assert.equal(callOrder.includes("flushed"), true);
  assert.equal(callOrder.includes("readResult"), false);
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
      payload.resultTransfers = await payload.turnPersistence.readResultTransfers();
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
  assert.deepEqual(capturedFinalizePayload.resultTransfers, []);
  assert.deepEqual(
    durableMessages.map((message) => [message.messageUid, message.summarized]),
    [
      ["sm_checkpoint-tool", true],
      ["sm_tail-tool", true],
      ["sm_final-assistant", true],
    ],
  );
});

test("runSession finalization never expands committed scope members from history", async () => {
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
      payload.resultTransfers = await payload.turnPersistence.readResultTransfers();
      return { ok: true };
    },
  });

  await runner.runAcceptedSession({
    userId: "u1",
    sessionId: "s1",
    message: "hello",
    turnScopeId: "turn-a",
  });

  assert.deepEqual(capturedFinalizePayload.resultTransfers, []);
  assert.equal(Object.hasOwn(capturedFinalizePayload.turnPersistence, "readResultMessages"), false);
});

test("runSession finalizes a checkpoint tail without loading its committed prefix", async () => {
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
      payload.resultTransfers = await payload.turnPersistence.readResultTransfers();
      return { ok: true };
    },
  });

  await runner.runAcceptedSession({
    userId: "u1",
    sessionId: "s1",
    message: "hello",
    turnScopeId: "turn-a",
  });

  assert.deepEqual(capturedFinalizePayload.resultTransfers, []);
  assert.equal(Object.hasOwn(capturedFinalizePayload.turnPersistence, "readResultMessages"), false);
});

test("finalizer preserves persisted activity while flushing the active message delta", async () => {
  let capturedFinalizePayload = null;
  const runtime = createTestRuntimeContext();
  const durable = new Map();
  const writes = [];
  const activity = {
    messageUid: "sm_activity",
    role: "assistant",
    type: "tool_call",
    turnScopeId: "turn-a",
    dialogProcessId: "dialog-1",
    activityTimeline: [{ eventId: "guidance-analysis:1" }],
  };
  const finalMessage = {
    messageUid: "sm_final",
    modelMessageId: "message-final",
    role: "assistant",
    type: "message",
    content: "done",
    turnScopeId: "turn-a",
    dialogProcessId: "dialog-1",
  };
  const runner = createRunner({
    callOrder: [],
    runtime,
    agentRunner: async () => {
      runtime.currentTurnMessages.push(activity);
      await runtime.persistCurrentTurnMessages();
      writes.length = 0;
      return {
        output: "done",
        modelMessageId: "message-final",
        traces: [],
        turnMessages: [finalMessage],
        modelLoopRound: 0,
        modelMessages: [],
      };
    },
    appendAgentMessages: async ({ messages, ...identity }) => {
      for (const message of messages) {
        writes.push(message.messageUid);
        durable.set(message.messageUid, structuredClone(message));
      }
      return createTestMessagePersistenceReceipts({ messages, ...identity });
    },
    getSessionTurns: async () => [
      assert.fail("finalization must not reconstruct persisted history"),
    ],
    finalizeRunSession: async (payload = {}) => {
      capturedFinalizePayload = payload;
      await payload.turnPersistence.flush();
      payload.resultTransfers = await payload.turnPersistence.readResultTransfers();
      return { ok: true };
    },
  });

  await runner.runAcceptedSession({
    userId: "u1",
    sessionId: "s1",
    message: "hello",
    turnScopeId: "turn-a",
  });

  assert.deepEqual(capturedFinalizePayload.resultTransfers, []);
  assert.deepEqual(writes, ["sm_final"]);
  assert.equal(durable.get("sm_final").content, "done");
  assert.deepEqual(durable.get("sm_activity").activityTimeline, activity.activityTimeline);
});
