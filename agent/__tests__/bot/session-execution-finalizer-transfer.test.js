/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import test from "node:test";
import assert from "node:assert/strict";

import { SessionExecutionFinalizer } from "../../src/bot/execution/finalizer.js";

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
          attachments: [
            {
              attachmentId: "att-generated",
              attachmentSource: "model",
              generatedByModel: true,
              name: "image.png",
              mimeType: "image/png",
              path: "/attachments/image.png",
              generationSource: "semantic_transfer_tool_output",
              owner: { type: "plugin", id: "harness-plugin", extra: "drop" },
            },
          ],
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
    finalAssistant.transferEnvelopes[0]?.files?.[0]?.attachmentId,
    "att-generated",
  );
  assert.equal(finalAssistant.transferEnvelopes[0]?.files?.[0]?.owner?.type, "plugin");
  assert.equal("attachmentMeta" in finalAssistant.transferEnvelopes[0].files[0], false);
  assert.equal(appendedMessages.find((item = {}) => item.role === "assistant")?.attachmentMetas, undefined);
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
  assert.equal(appendedMessages.find((item = {}) => item.role === "assistant")?.transferEnvelopes, undefined);
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
      async getExecutionBundle() { return { logs: [] }; },
    },
    turnPersister: {
      buildDefaultAssistantTurn: () => ({}),
      async appendAgentMessages({ messages = [] }) { appendedMessages.push(...messages); },
    },
    resolveMemoryPostProcessAsyncEnabled: () => true,
    runMemoryPostProcessFlow: async () => {},
    upsertParentAsyncTask: () => {},
  });

  const result = await finalizer.finalizeRunSession({
    userId: "u1",
    sessionId: "s1",
    alreadyPersistedTurnMessageCount: 1,
    summaryCheckpointPromotionSources: [{
      role: "tool",
      type: "tool_result",
      attachments: [{
        attachmentId: "att-checkpoint",
        generatedByModel: true,
        generationSource: "multimodal_generate_tool",
      }],
    }],
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
      async getExecutionBundle() { return { logs: [] }; },
    },
    turnPersister: {
      buildDefaultAssistantTurn: () => ({}),
      async appendAgentMessages({ messages = [] }) { appendedMessages.push(...messages); },
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

  assert.deepEqual(appendedMessages.map((item) => item.content), ["tail"]);
  assert.deepEqual(result.messages.map((item) => item.content), ["persisted-1", "persisted-2", "tail"]);
});

test("SessionExecutionFinalizer skips non-contiguous persisted UIDs without duplicating the result", async () => {
  const appendedMessages = [];
  const finalizer = new SessionExecutionFinalizer({
    session: {
      async upsertTurnTiming() {},
      async saveCurrentTurnTasks() {},
      async getExecutionBundle() { return { logs: [] }; },
    },
    turnPersister: {
      buildDefaultAssistantTurn: () => ({}),
      async appendAgentMessages({ messages = [] }) { appendedMessages.push(...messages); },
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

  assert.deepEqual(appendedMessages.map((message) => message.messageUid), ["sm_tail"]);
  assert.deepEqual(result.messages.map((message) => message.messageUid), ["sm_old", "sm_retained", "sm_tail"]);
});
