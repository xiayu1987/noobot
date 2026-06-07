import test from "node:test";
import assert from "node:assert/strict";

import { SessionTurnPersister } from "../../../src/system-core/bot-manage/execution/turn-persister.js";

test("SessionTurnPersister does not persist transfer envelopes into session turns", async () => {
  const appendedTurns = [];
  const session = {
    appendExecutionLog: async () => {},
    appendTurn: async (payload = {}) => {
      appendedTurns.push(payload);
    },
  };
  const persister = new SessionTurnPersister({ session });

  await persister.appendAgentMessages({
    userId: "u1",
    sessionId: "s1",
    messages: [
      {
        role: "tool",
        type: "tool_result",
        tool_call_id: "call_1",
        toolName: "multimodal_generate",
        content: JSON.stringify({ toolName: "multimodal_generate", ok: true }),
        transferEnvelope: { protocol: "noobot.semantic-transfer", files: [] },
        transferEnvelopes: [{ protocol: "noobot.semantic-transfer", files: [] }],
      },
    ],
    dialogProcessId: "dp1",
  });

  assert.equal(appendedTurns.length, 1);
  assert.equal("transferEnvelope" in appendedTurns[0], false);
  assert.equal("transferEnvelopes" in appendedTurns[0], false);
});

test("SessionTurnPersister drops direct-consumed intermediate tool payloads and metas", async () => {
  const appendedTurns = [];
  const executionLogs = [];
  const session = {
    appendExecutionLog: async (payload = {}) => {
      executionLogs.push(payload);
    },
    appendTurn: async (payload = {}) => {
      appendedTurns.push(payload);
    },
  };
  const persister = new SessionTurnPersister({ session });

  await persister.appendAgentMessages({
    userId: "u1",
    sessionId: "s1",
    messages: [
      {
        role: "tool",
        type: "tool_result",
        tool_call_id: "call_doc",
        toolName: "doc_to_data",
        attachmentMetas: [
          {
            attachmentId: "parsed_1",
            name: "input.doc2data.md",
            generationSource: "doc_to_data_tool",
          },
        ],
        content: JSON.stringify({
          toolName: "doc_to_data",
          ok: true,
          status: "completed",
          text: "very large parsed text".repeat(100),
          attachmentMetas: [
            {
              attachmentId: "parsed_1",
              generationSource: "doc_to_data_tool",
            },
          ],
          summary: { saved_attachment_count: 1 },
        }),
      },
    ],
    dialogProcessId: "dp1",
  });

  assert.equal(appendedTurns.length, 1);
  assert.deepEqual(appendedTurns[0].attachmentMetas, []);
  const persistedContent = JSON.parse(appendedTurns[0].content);
  assert.equal(persistedContent.intermediateConsumedByModel, true);
  assert.equal(persistedContent.sessionPersistence, "summary_only");
  assert.equal("text" in persistedContent, false);
  const fullTurnLog = executionLogs[0]?.data || {};
  assert.deepEqual(fullTurnLog.attachmentMetas, []);
  assert.equal(JSON.parse(fullTurnLog.content).sessionPersistence, "summary_only");
});
