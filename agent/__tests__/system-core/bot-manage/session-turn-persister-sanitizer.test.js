import test from "node:test";
import assert from "node:assert/strict";

import { SessionTurnPersister } from "../../../src/system-core/bot-manage/execution/turn-persister.js";

test("SessionTurnPersister does not persist intermediate tool transfer envelopes into session turns", async () => {
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

test("SessionTurnPersister persists final assistant transfer envelopes without attachment mirror", async () => {
  const appendedTurns = [];
  const session = {
    appendExecutionLog: async () => {},
    appendTurn: async (payload = {}) => {
      appendedTurns.push(payload);
    },
  };
  const persister = new SessionTurnPersister({ session });
  const envelope = {
    protocol: "noobot.semantic-transfer",
    version: 1,
    direction: "output",
    transport: "file",
    files: [{ attachmentMeta: { attachmentId: "att-final" }, role: "primary" }],
  };

  await persister.appendAgentMessages({
    userId: "u1",
    sessionId: "s1",
    messages: [
      {
        role: "assistant",
        type: "message",
        content: "done",
        transferEnvelope: envelope,
        transferEnvelopes: [envelope],
      },
    ],
    dialogProcessId: "dp1",
  });

  assert.equal(appendedTurns.length, 1);
  assert.equal(appendedTurns[0].attachmentMetas, undefined);
  assert.equal(appendedTurns[0].transferEnvelope?.files?.[0]?.attachmentMeta?.attachmentId, "att-final");
  assert.equal(appendedTurns[0].transferEnvelopes?.length, 1);
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

test("SessionTurnPersister persists canonical plugin metadata without old concrete-plugin fields", async () => {
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
  const pluginMeta = {
    source: "workflow-plugin",
    kind: "workflow",
    phase: "planning",
    payload: {
      semantic: {
        nodes: [{ id: "a1", type: "action", name: "A1" }],
        flowtos: [{ from: "start", to: "a1" }],
      },
    },
  };

  await persister.appendAgentMessages({
    userId: "u1",
    sessionId: "s1",
    messages: [
      {
        role: "assistant",
        type: "workflow",
        content: "WORKFLOW_DSL/1",
        pluginMessage: true,
        pluginMeta,
      },
    ],
    dialogProcessId: "dp1",
  });

  assert.equal(appendedTurns.length, 1);
  assert.equal(appendedTurns[0].pluginMessage, true);
  assert.equal(appendedTurns[0].pluginMeta?.payload?.semantic?.nodes?.length, 1);
  assert.equal(appendedTurns[0].workflowMessage, undefined);
  assert.equal(appendedTurns[0].workflowMeta, undefined);
  assert.equal(executionLogs[0]?.data?.pluginMessage, true);
  assert.equal(executionLogs[0]?.data?.pluginMeta?.payload?.semantic?.flowtos?.length, 1);
  assert.equal(executionLogs[0]?.data?.workflowMessage, undefined);
  assert.equal(executionLogs[0]?.data?.workflowMeta, undefined);
});
