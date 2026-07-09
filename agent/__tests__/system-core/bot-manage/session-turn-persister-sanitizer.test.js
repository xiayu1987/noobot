import test from "node:test";
import assert from "node:assert/strict";

import { SessionTurnPersister } from "../../../src/system-core/bot-manage/execution/turn-persister.js";

test("SessionTurnPersister scopes stopped assistant persistence by turnScopeId", async () => {
  const appendedTurns = [];
  const markedTurns = [];
  const session = {
    markUserMessageMonotonic: async (payload = {}) => {
      markedTurns.push(payload);
    },
    getSessionBundle: async () => ({
      session: {
        messages: [
          { role: "user", turnScopeId: "turn-old", dialogProcessId: "dp-reused" },
          { role: "user", turnScopeId: "turn-new", dialogProcessId: "dp-reused" },
        ],
      },
    }),
    appendExecutionLog: async () => {},
    appendTurn: async (payload = {}) => {
      appendedTurns.push(payload);
    },
  };
  const persister = new SessionTurnPersister({ session });

  const saved = await persister.persistStoppedAssistantMessage({
    userId: "u1",
    sessionId: "s1",
    partialAssistant: {
      content: "partial",
      dialogProcessId: "dp-reused",
      turnScopeId: "turn-new",
    },
  });

  assert.equal(saved, true);
  assert.equal(markedTurns.length, 1);
  assert.equal(markedTurns[0].turnScopeId, "turn-new");
  assert.equal(markedTurns[0].dialogProcessId, undefined);
  assert.equal(appendedTurns.length, 1);
  assert.equal(appendedTurns[0].turnScopeId, "turn-new");
  assert.equal(appendedTurns[0].dialogProcessId, "dp-reused");
  assert.equal(appendedTurns[0].stopState, "user_stopped");
});

test("SessionTurnPersister persists tool transfer envelopes into session turns", async () => {
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
        transferEnvelopes: [{ protocol: "noobot.semantic-transfer", files: [] }],
      },
    ],
    dialogProcessId: "dp1",
  });

  assert.equal(appendedTurns.length, 1);
  assert.equal("transferEnvelopes" in appendedTurns[0], true);
  assert.equal(appendedTurns[0].transferEnvelopes?.[0]?.protocol, "noobot.semantic-transfer");
});

test("SessionTurnPersister persists final assistant transfer envelopes with attachment mirror", async () => {
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
        attachments: [{ attachmentId: "att-final", name: "final.md" }],
        transferEnvelopes: [envelope],
      },
    ],
    dialogProcessId: "dp1",
  });

  assert.equal(appendedTurns.length, 1);
  assert.equal(appendedTurns[0].attachmentMetas, undefined);
  assert.deepEqual(appendedTurns[0].attachments, [{ attachmentId: "att-final", name: "final.md" }]);
  assert.equal("transferEnvelopes" in appendedTurns[0], true);
  assert.equal("attachmentMeta" in appendedTurns[0].transferEnvelopes?.[0]?.files?.[0], false);
  assert.equal(appendedTurns[0].transferEnvelopes?.[0]?.files?.[0]?.attachmentId, "att-final");
  assert.equal("id" in appendedTurns[0].transferEnvelopes?.[0]?.files?.[0], false);
  assert.equal("type" in appendedTurns[0].transferEnvelopes?.[0]?.files?.[0], false);
  assert.equal("source" in appendedTurns[0].transferEnvelopes?.[0]?.files?.[0], false);
  assert.equal(appendedTurns[0].transferEnvelopes?.length, 1);
});

test("SessionTurnPersister drops direct-consumed intermediate tool payloads and legacy metas without dropping refresh metadata", async () => {
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
        attachments: [
          {
            attachmentId: "parsed_1",
            name: "input.doc2data.md",
            generationSource: "doc_to_data_tool",
          },
        ],
        transferEnvelopes: [
          {
            protocol: "noobot.semantic-transfer",
            files: [
              {
                attachmentMeta: {
                  attachmentId: "parsed_1",
                  generationSource: "doc_to_data_tool",
                },
                role: "primary",
              },
            ],
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
  assert.equal(appendedTurns[0].attachmentMetas, undefined);
  assert.deepEqual(appendedTurns[0].attachments, []);
  assert.equal(appendedTurns[0].transferEnvelopes?.[0]?.protocol, "noobot.semantic-transfer");
  assert.equal("attachmentMeta" in appendedTurns[0].transferEnvelopes?.[0]?.files?.[0], false);
  assert.equal(appendedTurns[0].transferEnvelopes?.[0]?.files?.[0]?.attachmentId, "parsed_1");
  const persistedContent = JSON.parse(appendedTurns[0].content);
  assert.equal(persistedContent.intermediateConsumedByModel, true);
  assert.equal(persistedContent.sessionPersistence, "summary_only");
  assert.equal("text" in persistedContent, false);
  assert.equal("text_length" in persistedContent.summary, false);
  assert.deepEqual(persistedContent.summary, { saved_attachment_count: 1 });
  const fullTurnLog = executionLogs[0]?.data || {};
  assert.equal(fullTurnLog.attachments?.count, 0);
  assert.equal(fullTurnLog.transferEnvelopes?.count, 1);
  assert.equal(fullTurnLog.content?.preview.includes("summary_only"), true);
  assert.equal("text" in JSON.parse(appendedTurns[0].content), false);
});

test("SessionTurnPersister hides web_to_data intermediate payloads", async () => {
  const appendedTurns = [];
  const session = {
    appendExecutionLog: async () => {},
    appendTurn: async (payload = {}) => appendedTurns.push(payload),
  };
  const persister = new SessionTurnPersister({ session });

  await persister.appendAgentMessages({
    userId: "u1",
    sessionId: "s1",
    messages: [
      {
        role: "tool",
        type: "tool_result",
        tool_call_id: "call_web",
        toolName: "web_to_data",
        content: JSON.stringify({
          toolName: "web_to_data",
          ok: true,
          text: "large web text".repeat(100),
          attachmentMetas: [{ attachmentId: "web_1", generationSource: "web_to_data_tool" }],
        }),
      },
    ],
    dialogProcessId: "dp1",
  });

  const persistedContent = JSON.parse(appendedTurns[0].content);
  assert.equal(persistedContent.sessionPersistence, "summary_only");
  assert.equal("text" in persistedContent, false);
  assert.equal("text_length" in persistedContent.summary, false);
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
  assert.equal(executionLogs[0]?.data?.pluginMeta?.present, true);
  assert.equal(executionLogs[0]?.data?.pluginMeta?.keys?.includes("payload"), true);
  assert.equal(executionLogs[0]?.data?.workflowMessage, undefined);
  assert.equal(executionLogs[0]?.data?.workflowMeta, undefined);
});

test("SessionTurnPersister writes thinking timing to turn timing source when injected user messages precede assistant", async () => {
  const appendedTurns = [];
  const session = {
    appendExecutionLog: async () => {},
    appendTurn: async (payload = {}) => {
      appendedTurns.push(payload);
    },
  };
  const persister = new SessionTurnPersister({ session });
  const thinkingStartedAt = "2026-07-08T15:45:58.275Z";
  const thinkingFinishedAt = "2026-07-08T15:47:11.710Z";

  await persister.appendAgentMessages({
    userId: "u1",
    sessionId: "s1",
    messages: [
      {
        role: "user",
        type: "message",
        content: "[来自harness外部模型输出/guidance]",
        injectedMessage: true,
        injectedBy: "harness-plugin",
      },
      {
        role: "assistant",
        type: "message",
        content: "done",
      },
    ],
    dialogProcessId: "dp1",
    thinkingStartedAt,
    thinkingFinishedAt,
  });

  assert.equal(appendedTurns.length, 2);
  assert.equal(appendedTurns[0].role, "user");
  assert.equal(appendedTurns[0].thinkingStartedAt, "");
  assert.equal(appendedTurns[0].thinkingFinishedAt, "");
  assert.equal(appendedTurns[0].turnTimingThinkingStartedAt, thinkingStartedAt);
  assert.equal(appendedTurns[0].turnTimingThinkingFinishedAt, thinkingFinishedAt);
  assert.equal(appendedTurns[1].role, "assistant");
  assert.equal(appendedTurns[1].thinkingStartedAt, "");
  assert.equal(appendedTurns[1].thinkingFinishedAt, "");
  assert.equal(appendedTurns[1].turnTimingThinkingStartedAt, "");
  assert.equal(appendedTurns[1].turnTimingThinkingFinishedAt, "");
});
