/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { TRANSFER_VERSION } from "@noobot/semantic-transfer-protocol";
import test from "node:test";
import assert from "node:assert/strict";
import { createNoopMemoryPostProcessService } from "../helpers/memory-postprocess-service.js";

import { SessionExecutionFinalizer } from "../../src/bot/execution/finalizer.js";
import { projectGeneratedArtifactsToFinalAssistant } from "../../src/runtime/turn/final-assistant-artifact-projection.js";
import { createCurrentTurnMessagesStore } from "../../src/runtime/turn/current-turn-ledger.js";
import { createAgentTurnResult } from "@noobot/agent-transport-protocol/agent-turn-result";

function semanticTransferEnvelope() {
  return {
    protocol: "noobot.semantic-transfer",
    version: TRANSFER_VERSION,
    transferId: "transfer:assistant-message:tool:tool-call-1:output:tool_result_text",
    presentationMessageId: "assistant-message",
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

test("final assistant preserves independent attachments and removes only transferred identities", () => {
  const transferred = {
    attachmentId: "att-generated",
    sessionId: "s1",
    attachmentSource: "model",
    name: "image.png",
    mimeType: "image/png",
  };
  const independent = { ...transferred, attachmentId: "independent" };
  const messages = projectGeneratedArtifactsToFinalAssistant([
    { role: "tool", transferEnvelopes: [semanticTransferEnvelope()] },
    { role: "assistant", content: "done", attachments: [transferred, independent] },
  ]);
  assert.deepEqual(messages[1].attachments, [independent]);
  assert.equal(messages[1].transferEnvelopes.length, 1);
});

test("SessionExecutionFinalizer waits for execution event durability before reading the bundle", async () => {
  const order = [];
  const finalizer = new SessionExecutionFinalizer({
    session: {
      async saveExecutionReport() {},
      async upsertTurnTiming() {},
      async getExecutionTurnLogs() {
        order.push("bundle");
        return [];
      },
    },
    turnPersister: {
      async appendAgentMessages() {},
    },
    memoryPostProcessService: createNoopMemoryPostProcessService(),
    now: () => new Date().toISOString(),
  });

  await finalizer.finalizeRunSession({
    userId: "u1",
    sessionId: "s1",
    dialogProcessId: "dp1",
    agentResult: {
      output: "done",
      turnMessages: [
        { messageUid: "sm_done", role: "assistant", type: "message", content: "done" },
      ],
    },
    persistedTurnMessageUids: [],
    persistedTurnMessages: [],
    durableTurnMessages: [],
    summaryCheckpointPromotionSources: [],
    lifecycle: {
      enterPersisting: () => order.push("persisting"),
      enterMemory: () => order.push("memory"),
      complete: () => order.push("completed"),
    },
    runtimeEventListener: {
      onEvent() {},
      async flush() {
        order.push("flush");
      },
    },
  });

  assert.deepEqual(order.slice(-2), ["flush", "bundle"]);
  assert.equal(order.includes("completed"), false);
});

test("SessionExecutionFinalizer rejects completion when execution event persistence fails", async () => {
  const events = [];
  let bundleReads = 0;
  const finalizer = new SessionExecutionFinalizer({
    session: {
      async saveExecutionReport() {},
      async upsertTurnTiming() {},
      async getExecutionTurnLogs() {
        bundleReads += 1;
        return [];
      },
    },
    turnPersister: {
      async appendAgentMessages() {},
    },
    memoryPostProcessService: createNoopMemoryPostProcessService(),
    now: () => new Date().toISOString(),
  });

  await assert.rejects(
    finalizer.finalizeRunSession({
      dialogProcessId: "dp1",
      userId: "u1",
      sessionId: "s1",
      turnScopeId: "turn-1",
      agentResult: {
        output: "done",
        turnMessages: [
          { messageUid: "sm_done", role: "assistant", type: "message", content: "done" },
        ],
      },
      persistedTurnMessageUids: [],
      persistedTurnMessages: [],
      durableTurnMessages: [],
      summaryCheckpointPromotionSources: [],
      lifecycle: {
        complete: () => events.push("completed"),
      },
      runtimeEventListener: {
        onEvent: ({ event, data }) => events.push({ event, data }),
        async flush() {
          const error = new Error("EPERM: operation not permitted");
          error.code = "EPERM";
          throw error;
        },
      },
    }),
    { code: "EPERM" },
  );

  assert.equal(bundleReads, 0);
  assert.equal(events.includes("completed"), false);
});

test("SessionExecutionFinalizer promotes semantic-transfer attachments as transfer envelopes without mirror", async () => {
  const appendedMessages = [];
  const finalizer = new SessionExecutionFinalizer({
    session: {
      async saveExecutionReport() {},
      async upsertTurnTiming() {},
      async getExecutionTurnLogs() {
        return [];
      },
    },
    turnPersister: {
      async appendAgentMessages({ messages = [] } = {}) {
        appendedMessages.push(...messages);
      },
    },
    memoryPostProcessService: createNoopMemoryPostProcessService(),
    now: () => new Date().toISOString(),
  });

  const result = await finalizer.finalizeRunSession({
    userId: "u1",
    sessionId: "s1",
    dialogProcessId: "dp1",
    persistedTurnMessageUids: [],
    persistedTurnMessages: [],
    durableTurnMessages: [],
    summaryCheckpointPromotionSources: [],
    agentResult: {
      output: "done",
      turnMessages: [
        {
          messageUid: "sm_transfer_tool",
          role: "tool",
          type: "tool_result",
          transferEnvelopes: [semanticTransferEnvelope()],
        },
        { messageUid: "sm_done", role: "assistant", type: "message", content: "done" },
      ],
    },
  });

  const finalAssistant = result.messages.find((item = {}) => item.role === "assistant") || {};
  assert.equal(finalAssistant.attachmentMetas, undefined);
  assert.deepEqual(finalAssistant.attachments, []);
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
      async saveExecutionReport() {},
      async upsertTurnTiming() {},
      async getExecutionTurnLogs() {
        return [];
      },
    },
    turnPersister: {
      async appendAgentMessages({ messages = [] } = {}) {
        appendedMessages.push(...messages);
      },
    },
    memoryPostProcessService: createNoopMemoryPostProcessService(),
    now: () => new Date().toISOString(),
  });

  const result = await finalizer.finalizeRunSession({
    userId: "u1",
    sessionId: "s1",
    dialogProcessId: "dp1",
    persistedTurnMessageUids: [],
    persistedTurnMessages: [],
    durableTurnMessages: [],
    summaryCheckpointPromotionSources: [],
    agentResult: {
      output: "done",
      turnMessages: [
        {
          messageUid: "sm_ordinary_tool",
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
        { messageUid: "sm_done", role: "assistant", type: "message", content: "done" },
      ],
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
      async saveExecutionReport() {},
      async upsertTurnTiming() {},
      async flushSessionMessagesToArchive() {},
      async getExecutionTurnLogs() {
        return [];
      },
    },
    turnPersister: {
      async appendAgentMessages({ messages = [] }) {
        appendedMessages.push(...messages);
      },
    },
    memoryPostProcessService: createNoopMemoryPostProcessService(),
    now: () => new Date().toISOString(),
  });

  const result = await finalizer.finalizeRunSession({
    dialogProcessId: "dp1",
    userId: "u1",
    sessionId: "s1",
    persistedTurnMessageUids: ["sm_persisted"],
    persistedTurnMessages: [
      {
        messageUid: "sm_persisted",
        role: "assistant",
        content: "already persisted",
        summarized: false,
      },
    ],
    durableTurnMessages: [
      {
        messageUid: "sm_persisted",
        role: "assistant",
        content: "already persisted",
        summarized: false,
      },
    ],
    summaryCheckpointPromotionSources: [
      {
        messageUid: "sm_checkpoint_tool",
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
        {
          messageUid: "sm_persisted",
          role: "assistant",
          content: "already persisted",
          summarized: false,
        },
        { messageUid: "sm_tail", role: "assistant", type: "message", content: "tail" },
      ],
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
      async saveExecutionReport() {},
      async upsertTurnTiming() {},
      async flushSessionMessagesToArchive() {},
      async getExecutionTurnLogs() {
        return [];
      },
    },
    turnPersister: {
      async appendAgentMessages({ messages = [] }) {
        appendedMessages.push(...messages);
      },
    },
    memoryPostProcessService: createNoopMemoryPostProcessService(),
    now: () => new Date().toISOString(),
  });

  const result = await finalizer.finalizeRunSession({
    dialogProcessId: "dp1",
    userId: "u1",
    sessionId: "s1",
    persistedTurnMessageUids: ["sm_p1", "sm_p2"],
    persistedTurnMessages: [
      { messageUid: "sm_p1", role: "assistant", content: "persisted-1" },
      { messageUid: "sm_p2", role: "tool", content: "persisted-2" },
    ],
    durableTurnMessages: [
      { messageUid: "sm_p1", role: "assistant", content: "persisted-1" },
      { messageUid: "sm_p2", role: "tool", content: "persisted-2" },
    ],
    summaryCheckpointPromotionSources: [],
    agentResult: {
      turnMessages: [{ messageUid: "sm_tail", role: "assistant", content: "tail" }],
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
      async saveExecutionReport() {},
      async upsertTurnTiming() {},
      async getExecutionTurnLogs() {
        return [];
      },
    },
    turnPersister: {
      async appendAgentMessages({ messages = [] }) {
        appendedMessages.push(...messages);
      },
    },
    memoryPostProcessService: createNoopMemoryPostProcessService(),
    now: () => new Date().toISOString(),
  });

  const result = await finalizer.finalizeRunSession({
    dialogProcessId: "dp1",
    userId: "u1",
    sessionId: "s1",
    persistedTurnMessageUids: ["sm_old", "sm_retained"],
    persistedTurnMessages: [
      { messageUid: "sm_old", role: "assistant", content: "old" },
      { messageUid: "sm_retained", role: "tool", content: "retained" },
    ],
    durableTurnMessages: [
      { messageUid: "sm_old", role: "assistant", content: "old" },
      { messageUid: "sm_retained", role: "tool", content: "retained" },
    ],
    summaryCheckpointPromotionSources: [],
    agentResult: {
      turnMessages: [
        { messageUid: "sm_retained", role: "tool", content: "retained" },
        { messageUid: "sm_tail", role: "assistant", content: "tail" },
      ],
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
      async saveExecutionReport() {},
      async upsertTurnTiming() {},
      async getExecutionTurnLogs() {
        return [];
      },
    },
    turnPersister: {
      async appendAgentMessages({ messages = [] }) {
        appendedMessages.push(...messages);
      },
    },
    memoryPostProcessService: createNoopMemoryPostProcessService(),
    now: () => new Date().toISOString(),
  });

  const result = await finalizer.finalizeRunSession({
    dialogProcessId: "dp1",
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
    durableTurnMessages: [
      { messageUid: "sm_guidance", role: "user", content: "guidance", summarized: false },
    ],
    summaryCheckpointPromotionSources: [],
    agentResult: {
      turnMessages: [
        {
          messageUid: "sm_guidance",
          role: "user",
          content: "guidance",
          summarized: true,
        },
      ],
    },
    runtimeEventListener: {
      async flush() {},
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
  assert.deepEqual(persistencePlan.data.activeSummarizedMessageUids, ["sm_guidance"]);
  assert.deepEqual(persistencePlan.data.durableSummarizedMessageUids, []);
  assert.deepEqual(persistencePlan.data.persistedSummarizedMessageUids, ["sm_guidance"]);
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
      async saveExecutionReport() {},
      async upsertTurnTiming() {},
      async getExecutionTurnLogs() {
        return [];
      },
    },
    turnPersister: {
      async appendAgentMessages({ messages = [] } = {}) {
        appendedMessages.push(...messages);
      },
    },
    memoryPostProcessService: createNoopMemoryPostProcessService(),
    now: () => new Date().toISOString(),
  });
  await finalizer.finalizeRunSession({
    userId: "u1",
    sessionId: "s1",
    dialogProcessId: "dp1",
    turnScopeId: "turn-1",
    agentResult: { turnMessages: [{ ...durableMessage, summarized: true }] },
    persistedTurnMessages: [],
    durableTurnMessages: [durableMessage],
    persistedTurnMessageUids: [durableMessage.messageUid],
    summaryCheckpointPromotionSources: [],
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
  const agentResult = createAgentTurnResult({
    output: "done",
    traces: [],
    turnMessages: turnMessageStore.toArray(),
    modelMessages: [],
    modelLoopRound: 0,
  });
  assert.deepEqual(
    agentResult.turnMessages.map((message) => message.summarized),
    [true, true, false],
  );

  const appendedMessages = [];
  const finalizer = new SessionExecutionFinalizer({
    session: {
      async saveExecutionReport() {},
      async upsertTurnTiming() {},
      async getExecutionTurnLogs() {
        return [];
      },
    },
    turnPersister: {
      async appendAgentMessages({ messages = [] } = {}) {
        appendedMessages.push(...messages);
      },
    },
    memoryPostProcessService: createNoopMemoryPostProcessService(),
    now: () => new Date().toISOString(),
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
    summaryCheckpointPromotionSources: [],
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
      async saveExecutionReport() {},
      async upsertTurnTiming() {},
      async getExecutionTurnLogs() {
        return [];
      },
    },
    turnPersister: {
      async appendAgentMessages() {
        appendCalled = true;
      },
    },
    memoryPostProcessService: createNoopMemoryPostProcessService(),
    now: () => new Date().toISOString(),
  });

  await assert.rejects(
    finalizer.finalizeRunSession({
      dialogProcessId: "dp1",
      userId: "u1",
      sessionId: "s1",
      persistedTurnMessageUids: ["sm_missing"],
      persistedTurnMessages: [],
      durableTurnMessages: [],
      summaryCheckpointPromotionSources: [],
      agentResult: {
        turnMessages: [
          {
            messageUid: "sm_missing",
            role: "assistant",
            content: "canonical",
          },
        ],
      },
    }),
    /persisted turn message is missing from the durable journal: sm_missing/,
  );
  assert.equal(appendCalled, false);
});
