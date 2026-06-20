import test from "node:test";
import assert from "node:assert/strict";

import { SessionExecutionFinalizer } from "../../../src/system-core/bot-manage/execution/finalizer.js";

test("SessionExecutionFinalizer promotes semantic-transfer attachment metas as transfer envelopes without mirror", async () => {
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
          attachmentMetas: [
            {
              attachmentId: "att-generated",
              attachmentSource: "model",
              generatedByModel: true,
              name: "image.png",
              mimeType: "image/png",
              path: "/attachments/image.png",
              generationSource: "semantic_transfer_tool_output",
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
  assert.equal("transferEnvelope" in finalAssistant, false);
  assert.equal(Array.isArray(finalAssistant.transferEnvelopes), true);
  assert.equal(
    finalAssistant.transferEnvelopes[0]?.files?.[0]?.attachmentMeta?.attachmentId,
    "att-generated",
  );
  assert.equal(appendedMessages.find((item = {}) => item.role === "assistant")?.attachmentMetas, undefined);
});

test("SessionExecutionFinalizer does not promote ordinary generated attachments into semantic-transfer envelopes", async () => {
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
          attachmentMetas: [
            {
              attachmentId: "att-ordinary",
              attachmentSource: "model",
              generatedByModel: true,
              name: "image.png",
              mimeType: "image/png",
              path: "/attachments/image.png",
              generationSource: "multimodal_generate_tool",
            },
          ],
        },
        { role: "assistant", type: "message", content: "done" },
      ],
      turnTasks: [],
    },
  });

  const finalAssistant = result.messages.find((item = {}) => item.role === "assistant") || {};
  assert.equal("transferEnvelope" in finalAssistant, false);
  assert.equal("transferEnvelopes" in finalAssistant, false);
  assert.equal(finalAssistant.attachmentMetas, undefined);
  assert.equal(appendedMessages.find((item = {}) => item.role === "assistant")?.transferEnvelope, undefined);
});
