/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import test from "node:test";
import assert from "node:assert/strict";

import { SessionExecutionFinalizer } from "../../src/bot/execution/finalizer.js";
import { createCurrentTurnMessagesStore } from "../../src/runtime/turn/current-turn-ledger.js";
import { buildLoopResult } from "../../src/runtime/turn/turn-result-aggregator.js";

function semanticTransferEnvelope() {
  return {
    protocol: "noobot.semantic-transfer",
    version: 2,
    transferId: "transfer:assistant-message:tool:tool-call-1:output:tool_result_text",
    messageId: "assistant-message",
    identity: {
      sessionId: "s1",
      turnScopeId: "turn-1",
      runId: "run-1",
      producer: { type: "tool", id: "tool-call-1" },
    },
    direction: "output",
    payload: {
      mode: "attachment",
      attachments: [
        {
          identity: {
            attachmentId: "att-generated",
            sessionId: "s1",
            attachmentSource: "model",
          },
          role: "primary",
          name: "image.png",
          mimeType: "image/png",
        },
      ],
    },
    intent: {
      source: "tool",
      reason: "semantic_transfer_tool_output",
      scenario: "tool",
      strategy: "tool_result_text",
    },
    meta: {
      attributes: {
        generatedByModel: true,
        generationSource: "semantic_transfer_tool_output",
      },
    },
  };
}

test("SessionExecutionFinalizer waits for execution event durability before reading the bundle", async () => {
  const order = [];
  const finalizer = new SessionExecutionFinalizer({
    session: {
      async saveCurrentTurnTasks() {},
      async getExecutionBundle() {
        order.push("bundle");
        return { logs: [] };
      },
    },
    turnPersister: {
      buildDefaultAssistantTurn: () => ({ role: "assistant", type: "message", content: "done" }),
      async appendAgentMessages() {},
    },
    resolveMemoryPostProcessAsyncEnabled: () => true,
    runMemoryPostProcessFlow: async () => {},
    upsertParentAsyncTask: () => {},
  });

  await finalizer.finalizeRunSession({
    userId: "u1",
    sessionId: "s1",
    dialogProcessId: "dp1",
    agentResult: { output: "done", turnTasks: [] },
    lifecycle: {
      enterPersisting: () => order.push("persisting"),
      enterMemory: () => order.push("memory"),
      complete: () => order.push("completed"),
    },
    runtimeEventListener: {
      async flushPersistence() {
        order.push("flush");
      },
    },
  });

  assert.deepEqual(order.slice(-3), ["completed", "flush", "bundle"]);
});

test("SessionExecutionFinalizer promotes semantic-transfer attachments as transfer envelopes without mirror", async () => {
  const appendedMessages = [];
  const finalizer = new SessionExecutionFinalizer({
    session: {
      async saveCurrentTurnTasks() {},
      async getExecutionBundle() {
        return { logs: [] };
      },
    },
    turnPersister: {
      buildDefaultAssistantTurn: ({ agentResult = {}, dialogProcessId = "" } = {}) => ({
        role: "assistant",
        content: String(agentResult?.output || ""),
        type: "message",
        dialogProcessId,
      }),
      async appendAgentMessages({ messages = [] } = {}) {
        appendedMessages.push(...messages);
      },
    },
    resolveMemoryPostProcessAsyncEnabled: () => true,
    runMemoryPostProcessFlow: async () => {},
    upsertParentAsyncTask: () => {},
  });

  const result = await finalizer.finalizeRunSession({
    userId: "u1",
    sessionId: "s1",
    dialogProcessId: "dp1",
    agentResult: {
      output: "done",
      turnMessages: [
        {
          role: "tool",
          type: "tool_result",
          transferEnvelopes: [semanticTransferEnvelope()],
        },
        { role: "assistant", type: "message", content: "done" },
      ],
      turnTasks: [],
    },
  });

  const finalAssistant = result.messages.find((item = {}) => item.role === "assistant") || {};
  assert.equal(finalAssistant.attachmentMetas, undefined);
  assert.equal(finalAssistant.attachments, undefined);
  assert.equal("transferEnvelopes" in finalAssistant, true);
  assert.equal(Array.isArray(finalAssistant.transferEnvelopes), true);
  assert.equal(
    finalAssistant.transferEnvelopes[0]?.payload?.attachments?.[0]?.identity?.attachmentId,
    "att-generated",
  );
  assert.equal(finalAssistant.transferEnvelopes[0]?.identity?.producer?.type, "tool");
  assert.equal(
    "attachmentMeta" in finalAssistant.transferEnvelopes[0].payload.attachments[0],
    false,
  );
  assert.equal(
    appendedMessages.find((item = {}) => item.role === "assistant")?.attachmentMetas,
    undefined,
  );
});

test("SessionExecutionFinalizer promotes ordinary generated attachments to final assistant attachments", async () => {
  const appendedMessages = [];
  const finalizer = new SessionExecutionFinalizer({
    session: {
      async saveCurrentTurnTasks() {},
      async getExecutionBundle() {
        return { logs: [] };
      },
    },
    turnPersister: {
      buildDefaultAssistantTurn: ({ agentResult = {}, dialogProcessId = "" } = {}) => ({
        role: "assistant",
        content: String(agentResult?.output || ""),
        type: "message",
        dialogProcessId,
      }),
      async appendAgentMessages({ messages = [] } = {}) {
        appendedMessages.push(...messages);
      },
    },
    resolveMemoryPostProcessAsyncEnabled: () => true,
    runMemoryPostProcessFlow: async () => {},
    upsertParentAsyncTask: () => {},
  });

  const result = await finalizer.finalizeRunSession({
    userId: "u1",
    sessionId: "s1",
    dialogProcessId: "dp1",
    agentResult: {
      output: "done",
      turnMessages: [
        {
          role: "tool",
          type: "tool_result",
          attachments: [
            {
              attachmentId: "att-ordinary",
              sessionId: "s1",
              attachmentSource: "model",
              generatedByModel: true,
              name: "image.png",
              mimeType: "image/png",
              path: "/attachments/image.png",
              generationSource: "multimodal_generate_tool",
              owner: { type: "plugin", id: "harness-plugin", extra: "drop" },
              raw: "drop",
            },
          ],
        },
        { role: "assistant", type: "message", content: "done" },
      ],
      turnTasks: [],
    },
  });

  const finalAssistant = result.messages.find((item = {}) => item.role === "assistant") || {};
  assert.equal("transferEnvelopes" in finalAssistant, false);
  assert.equal(finalAssistant.attachmentMetas, undefined);
  assert.equal(finalAssistant.attachments?.[0]?.attachmentId, "att-ordinary");
  assert.equal(finalAssistant.attachments?.[0]?.owner?.type, "plugin");
  assert.equal("raw" in finalAssistant.attachments[0], false);
  assert.equal(
    appendedMessages.find((item = {}) => item.role === "assistant")?.transferEnvelopes,
    undefined,
  );
  assert.equal(
    appendedMessages.find((item = {}) => item.role === "assistant")?.attachments?.[0]?.attachmentId,
    "att-ordinary",
  );
});

test("SessionExecutionFinalizer promotes checkpoint attachment sources without rewriting persisted prefix", async () => {
  const appendedMessages = [];
  const finalizer = new SessionExecutionFinalizer({
    session: {
      async upsertTurnTiming() {},
      async flushSessionMessagesToArchive() {},
      async saveCurrentTurnTasks() {},
      async getExecutionBundle() {
        return { logs: [] };
      },
    },
    turnPersister: {
      buildDefaultAssistantTurn: () => ({}),
      async appendAgentMessages({ messages = [] }) {
        appendedMessages.push(...messages);
      },
    },
    resolveMemoryPostProcessAsyncEnabled: () => true,
    runMemoryPostProcessFlow: async () => {},
    upsertParentAsyncTask: () => {},
  });

  const result = await finalizer.finalizeRunSession({
    userId: "u1",
    sessionId: "s1",
    alreadyPersistedTurnMessageCount: 1,
    summaryCheckpointPromotionSources: [
      {
        role: "tool",
        type: "tool_result",
        attachments: [
          {
            attachmentId: "att-checkpoint",
            attachmentSource: "model",
            sessionId: "s1",
            name: "checkpoint.png",
            mimeType: "image/png",
            generatedByModel: true,
            generationSource: "multimodal_generate_tool",
          },
        ],
      },
    ],
    agentResult: {
      turnMessages: [
        { role: "assistant", content: "already persisted", summarized: false },
        { role: "assistant", type: "message", content: "tail" },
      ],
      turnTasks: [],
    },
  });

  assert.equal(appendedMessages.length, 1);
  assert.equal(appendedMessages[0].content, "tail");
  assert.equal(appendedMessages[0].attachments?.[0]?.attachmentId, "att-checkpoint");
  assert.deepEqual(
    result.messages.map((item) => item.content),
    ["already persisted", "tail"],
    "staged persistence must not change the pre-refactor finalizer result",
  );
});

test("SessionExecutionFinalizer restores the pre-refactor full result from persisted prefix plus active tail", async () => {
  const appendedMessages = [];
  const finalizer = new SessionExecutionFinalizer({
    session: {
      async upsertTurnTiming() {},
      async flushSessionMessagesToArchive() {},
      async saveCurrentTurnTasks() {},
      async getExecutionBundle() {
        return { logs: [] };
      },
    },
    turnPersister: {
      buildDefaultAssistantTurn: () => ({}),
      async appendAgentMessages({ messages = [] }) {
        appendedMessages.push(...messages);
      },
    },
    resolveMemoryPostProcessAsyncEnabled: () => true,
    runMemoryPostProcessFlow: async () => {},
    upsertParentAsyncTask: () => {},
  });

  const result = await finalizer.finalizeRunSession({
    userId: "u1",
    sessionId: "s1",
    persistedTurnMessages: [
      { role: "assistant", content: "persisted-1" },
      { role: "tool", content: "persisted-2" },
    ],
    agentResult: {
      turnMessages: [{ role: "assistant", content: "tail" }],
      turnTasks: [],
    },
  });

  assert.deepEqual(
    appendedMessages.map((item) => item.content),
    ["tail"],
  );
  assert.deepEqual(
    result.messages.map((item) => item.content),
    ["persisted-1", "persisted-2", "tail"],
  );
});

test("SessionExecutionFinalizer skips non-contiguous persisted UIDs without duplicating the result", async () => {
  const appendedMessages = [];
  const finalizer = new SessionExecutionFinalizer({
    session: {
      async upsertTurnTiming() {},
      async saveCurrentTurnTasks() {},
      async getExecutionBundle() {
        return { logs: [] };
      },
    },
    turnPersister: {
      buildDefaultAssistantTurn: () => ({}),
      async appendAgentMessages({ messages = [] }) {
        appendedMessages.push(...messages);
      },
    },
    resolveMemoryPostProcessAsyncEnabled: () => true,
    runMemoryPostProcessFlow: async () => {},
    upsertParentAsyncTask: () => {},
  });

  const result = await finalizer.finalizeRunSession({
    userId: "u1",
    sessionId: "s1",
    persistedTurnMessageUids: ["sm_old", "sm_retained"],
    persistedTurnMessages: [
      { messageUid: "sm_old", role: "assistant", content: "old" },
      { messageUid: "sm_retained", role: "tool", content: "retained" },
    ],
    agentResult: {
      turnMessages: [
        { messageUid: "sm_retained", role: "tool", content: "retained" },
        { messageUid: "sm_tail", role: "assistant", content: "tail" },
      ],
      turnTasks: [],
    },
  });

  assert.deepEqual(
    appendedMessages.map((message) => message.messageUid),
    ["sm_tail"],
  );
  assert.deepEqual(
    result.messages.map((message) => message.messageUid),
    ["sm_old", "sm_retained", "sm_tail"],
  );
});

test("SessionExecutionFinalizer persists canonical summary-state changes for an existing durable UID", async () => {
  const appendedMessages = [];
  const events = [];
  const finalizer = new SessionExecutionFinalizer({
    session: {
      async upsertTurnTiming() {},
      async saveCurrentTurnTasks() {},
      async getExecutionBundle() {
        return { logs: [] };
      },
    },
    turnPersister: {
      buildDefaultAssistantTurn: () => ({}),
      async appendAgentMessages({ messages = [] }) {
        appendedMessages.push(...messages);
      },
    },
    resolveMemoryPostProcessAsyncEnabled: () => true,
    runMemoryPostProcessFlow: async () => {},
    upsertParentAsyncTask: () => {},
  });

  const result = await finalizer.finalizeRunSession({
    userId: "u1",
    sessionId: "s1",
    persistedTurnMessageUids: ["sm_guidance"],
    persistedTurnMessages: [
      {
        messageUid: "sm_guidance",
        role: "user",
        content: "guidance",
        summarized: false,
      },
    ],
    agentResult: {
      turnMessages: [
        {
          messageUid: "sm_guidance",
          role: "user",
          content: "guidance",
          summarized: true,
        },
      ],
      turnTasks: [],
    },
    runtimeEventListener: {
      onEvent(event) {
        events.push(event);
      },
    },
  });

  assert.equal(appendedMessages.length, 1);
  assert.equal(appendedMessages[0].messageUid, "sm_guidance");
  assert.equal(appendedMessages[0].summarized, true);
  assert.equal(result.messages.length, 1);
  assert.equal(result.messages[0].messageUid, "sm_guidance");
  assert.equal(result.messages[0].summarized, true);
  const persistencePlan = events.find(
    (event = {}) => event.event === "agent.contextIdentity.completedTurnSummaryPersistencePlanned",
  );
  assert.ok(persistencePlan);
  assert.deepEqual(persistencePlan.data.activeSummarizedMessageIds, ["sm_guidance"]);
  assert.deepEqual(persistencePlan.data.durableSummarizedMessageIds, []);
  assert.deepEqual(persistencePlan.data.persistedSummarizedMessageIds, ["sm_guidance"]);
});

test("SessionExecutionFinalizer upserts summary marks for an already durable turn without checkpoint", async () => {
  const appendedMessages = [];
  const durableMessage = {
    messageUid: "turn-message-1",
    role: "assistant",
    type: "message",
    content: "tool result",
    summarized: false,
  };
  const finalizer = new SessionExecutionFinalizer({
    session: {
      async saveCurrentTurnTasks() {},
      async getExecutionBundle() {
        return { logs: [] };
      },
    },
    turnPersister: {
      buildDefaultAssistantTurn: () => durableMessage,
      async appendAgentMessages({ messages = [] } = {}) {
        appendedMessages.push(...messages);
      },
    },
    resolveMemoryPostProcessAsyncEnabled: () => true,
    runMemoryPostProcessFlow: async () => {},
    upsertParentAsyncTask: () => {},
  });
  await finalizer.finalizeRunSession({
    userId: "u1",
    sessionId: "s1",
    dialogProcessId: "dp1",
    turnScopeId: "turn-1",
    agentResult: { turnMessages: [{ ...durableMessage, summarized: true }], turnTasks: [] },
    persistedTurnMessages: [],
    durableTurnMessages: [durableMessage],
    persistedTurnMessageUids: [durableMessage.messageUid],
  });
  assert.equal(appendedMessages.length, 1);
  assert.equal(appendedMessages[0].messageUid, durableMessage.messageUid);
  assert.equal(appendedMessages[0].summarized, true);
});

test("completed turn summary policy marks are durably upserted before the next dialog", async () => {
  const durableMessages = [
    {
      messageUid: "turn-tool-call",
      role: "assistant",
      type: "tool_call",
      content: "",
      tool_calls: [{ id: "call-1", name: "read_file", args: {} }],
      summarized: false,
    },
    {
      messageUid: "turn-tool-result",
      role: "tool",
      type: "tool_result",
      content: "file content",
      tool_call_id: "call-1",
      toolName: "read_file",
      summarized: false,
    },
  ];
  const turnMessageStore = createCurrentTurnMessagesStore([
    ...durableMessages,
    {
      messageUid: "turn-final-answer",
      role: "assistant",
      type: "message",
      content: "done",
      summarized: false,
    },
  ]);
  turnMessageStore.updateWhere(
    { summarized: true },
    (_message, index) => index < durableMessages.length,
  );
  const agentResult = buildLoopResult({
    output: "done",
    traces: [],
    turnMessageStore,
    modelMessages: [],
  });
  assert.deepEqual(
    agentResult.turnMessages.map((message) => message.summarized),
    [true, true, false],
  );

  const appendedMessages = [];
  const finalizer = new SessionExecutionFinalizer({
    session: {
      async saveCurrentTurnTasks() {},
      async getExecutionBundle() {
        return { logs: [] };
      },
    },
    turnPersister: {
      buildDefaultAssistantTurn: () => agentResult.turnMessages.at(-1),
      async appendAgentMessages({ messages = [] } = {}) {
        appendedMessages.push(...messages);
      },
    },
    resolveMemoryPostProcessAsyncEnabled: () => true,
    runMemoryPostProcessFlow: async () => {},
    upsertParentAsyncTask: () => {},
  });
  await finalizer.finalizeRunSession({
    userId: "u1",
    sessionId: "s1",
    dialogProcessId: "dp1",
    turnScopeId: "turn-1",
    agentResult,
    persistedTurnMessages: [],
    durableTurnMessages: durableMessages,
    persistedTurnMessageUids: durableMessages.map((message) => message.messageUid),
  });

  assert.deepEqual(
    appendedMessages.map((message) => [message.messageUid, message.summarized]),
    [
      ["turn-tool-call", true],
      ["turn-tool-result", true],
      ["turn-final-answer", false],
    ],
  );
});

test("SessionExecutionFinalizer rejects a persisted UID without a durable journal entity", async () => {
  let appendCalled = false;
  const finalizer = new SessionExecutionFinalizer({
    session: {
      async saveCurrentTurnTasks() {},
      async getExecutionBundle() {
        return { logs: [] };
      },
    },
    turnPersister: {
      buildDefaultAssistantTurn: () => ({}),
      async appendAgentMessages() {
        appendCalled = true;
      },
    },
    resolveMemoryPostProcessAsyncEnabled: () => true,
    runMemoryPostProcessFlow: async () => {},
    upsertParentAsyncTask: () => {},
  });

  await assert.rejects(
    finalizer.finalizeRunSession({
      userId: "u1",
      sessionId: "s1",
      persistedTurnMessageUids: ["sm_missing"],
      persistedTurnMessages: [],
      agentResult: {
        turnMessages: [
          {
            messageUid: "sm_missing",
            role: "assistant",
            content: "canonical",
          },
        ],
        turnTasks: [],
      },
    }),
    /persisted turn message is missing from the durable journal: sm_missing/,
  );
  assert.equal(appendCalled, false);
});
