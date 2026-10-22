/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { TRANSFER_VERSION, TRANSFER_REASON } from "@noobot/semantic-transfer-protocol";
import test from "node:test";
import assert from "node:assert/strict";

import { createSessionPersistenceScope } from "@noobot/session-protocol";
import { SessionTurnPersister } from "../../src/bot/execution/turn-persister.js";
import {
  FLOW_CONTROL_ROLE,
  createFlowControlContextPolicy,
} from "@noobot/context-protocol/tool/context-policy";

test("appendAgentMessages persists all messages through one appendTurns batch", async () => {
  const batches = [];
  const persister = new SessionTurnPersister({
    session: {
      appendExecutionLog: async () => {},
      appendTurns: async (payload = {}) => {
        batches.push(payload);
        return { appended: true, reason: "", turns: payload.turns };
      },
    },
  });

  await persister.appendAgentMessages({
    userId: "u1",
    sessionId: "s1",
    messages: [
      { messageUid: "sm_1", role: "assistant", content: "tools" },
      { messageUid: "sm_2", role: "tool", content: "result", tool_call_id: "call_1" },
    ],
  });

  assert.equal(batches.length, 1);
  assert.deepEqual(
    batches[0].turns.map((turn) => turn.messageUid),
    ["sm_1", "sm_2"],
  );
});

test("appendAgentMessages preserves the canonical tool policy at the Session boundary", async () => {
  const batches = [];
  const policy = createFlowControlContextPolicy(FLOW_CONTROL_ROLE.CHECKPOINT_EVIDENCE);
  const persister = new SessionTurnPersister({
    session: {
      appendExecutionLog: async () => {},
      appendTurns: async (payload = {}) => {
        batches.push(payload);
        return { appended: true, reason: "", turns: payload.turns };
      },
    },
  });

  await persister.appendAgentMessages({
    userId: "u1",
    sessionId: "s1",
    messages: [
      {
        messageUid: "sm_result",
        role: "tool",
        content: "result",
        tool_call_id: "call_1",
        contextPolicy: policy,
      },
    ],
  });

  assert.deepEqual(batches[0].turns[0].contextPolicy, policy);
});

test("appendAgentMessages keeps scoped persistence identity for logs and messages", async () => {
  const executionPayloads = [];
  const batches = [];
  const persistenceScope = createSessionPersistenceScope({
    scopeId: "agent:child-1",
    parentSessionId: "root-1",
    relativeDir: "runtime/plugin-data/workflow/session/run/node",
    allowedRoot: "runtime/plugin-data/workflow/session",
  });
  const persister = new SessionTurnPersister({
    session: {
      appendExecutionLog: async (payload = {}) => executionPayloads.push(payload),
      appendTurns: async (payload = {}) => {
        batches.push(payload);
        return { appended: true, reason: "", turns: payload.turns };
      },
    },
  });

  await persister.appendAgentMessages({
    userId: "u1",
    sessionId: "child-1",
    parentSessionId: "root-1",
    turnScopeId: "workflow-node:one",
    messages: [{ role: "assistant", content: "done" }],
    persistenceScope,
  });

  assert.ok(executionPayloads.length >= 1);
  assert.equal(
    executionPayloads.every((payload) => payload.persistenceScope === persistenceScope),
    true,
  );
  assert.equal(batches.length, 1);
  assert.equal(batches[0].turns.length, 1);
  assert.equal(batches[0].persistenceScope, persistenceScope);
  assert.equal("persistenceScope" in batches[0].turns[0], false);
});

test("appendAgentMessages forwards the authoritative realtime message identity", async () => {
  const turns = [];
  const persister = new SessionTurnPersister({
    session: {
      appendExecutionLog: async () => {},
      appendTurns: async (payload = {}) => {
        turns.push(...payload.turns);
        return { appended: true, reason: "", turns: payload.turns };
      },
    },
  });

  await persister.appendAgentMessages({
    userId: "u1",
    sessionId: "s1",
    messages: [
      {
        role: "assistant",
        content: "done",
        modelMessageId: "message-1",
      },
    ],
  });

  assert.equal(turns[0].modelMessageId, "message-1");
});

test("appendAgentMessages forwards the canonical internal control message type", async () => {
  const turns = [];
  const persister = new SessionTurnPersister({
    session: {
      appendExecutionLog: async () => {},
      appendTurns: async (payload = {}) => {
        turns.push(...payload.turns);
        return { appended: true, reason: "", turns: payload.turns };
      },
    },
  });

  await persister.appendAgentMessages({
    userId: "u1",
    sessionId: "s1",
    messages: [
      {
        messageUid: "sm_control",
        role: "user",
        type: "context_control",
        content: "checkpoint",
        noobotInternalMessageType: "noobot.phase_summary_prompt",
      },
    ],
  });

  assert.equal(turns[0].noobotInternalMessageType, "noobot.phase_summary_prompt");
});

test("appendAgentMessages forwards presentation identity and checkpoint context", async () => {
  const batches = [];
  const persistenceScope = createSessionPersistenceScope({
    scopeId: "agent:running-turn",
    parentSessionId: "root-1",
    relativeDir: "runtime/plugin-data/workflow/session/run/turn",
    allowedRoot: "runtime/plugin-data/workflow/session",
  });
  const persister = new SessionTurnPersister({
    session: {
      appendExecutionLog: async () => {},
      appendTurns: async (payload = {}) => {
        batches.push(payload);
        return { appended: true, reason: "", turns: payload.turns };
      },
    },
  });

  await persister.appendAgentMessages({
    userId: "u1",
    sessionId: "s1",
    persistenceScope,
    messages: [
      {
        role: "assistant",
        content: "analysis",
        messageUid: "sm_analysis",
        modelMessageId: "msg_model_1",
        presentationMessageId: "msg_chat_1",
        chatPresentation: false,
        type: "tool_call",
        activityTimeline: [
          {
            eventId: "guidance-analysis:1",
            sequence: 1,
            sequenceDomain: "activity",
            sequenceScopeId: "msg_chat_1",
            authority: "authoritative",
          },
        ],
      },
    ],
  });

  const [turn] = batches[0].turns;
  assert.equal(turn.presentationMessageId, "msg_chat_1");
  assert.equal(turn.chatPresentation, false);
  assert.equal(turn.activityTimeline[0].eventId, "guidance-analysis:1");
  assert.equal(batches[0].persistenceScope, persistenceScope);
});

test("SessionTurnPersister never forwards a caller parentSessionId to persistence outlets", async () => {
  const batches = [];
  const executionLogs = [];
  const session = {
    appendExecutionLog: async (payload = {}) => executionLogs.push(payload),
    appendTurns: async (payload = {}) => {
      batches.push(payload);
      return { appended: true, reason: "", turns: payload.turns };
    },
  };
  const persister = new SessionTurnPersister({ session });

  await persister.appendAgentMessages({
    userId: "u1",
    sessionId: "s1",
    parentSessionId: "caller-parent",
    messages: [{ role: "assistant", content: "done" }],
    dialogProcessId: "dp1",
  });

  assert.equal(Object.hasOwn(batches[0], "parentSessionId"), false);
  assert.equal(Object.hasOwn(batches[0].turns[0], "parentSessionId"), false);
  assert.ok(executionLogs.length >= 1);
  assert.equal(
    executionLogs.some((log) => Object.hasOwn(log, "parentSessionId")),
    false,
  );
});

test("SessionTurnPersister persists tool transfer envelopes into session turns", async () => {
  const appendedTurns = [];
  const session = {
    appendExecutionLog: async () => {},
    appendTurns: async (payload = {}) => {
      appendedTurns.push(...payload.turns);
      return { appended: true, reason: "", turns: payload.turns };
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
        transferEnvelopes: [
          {
            protocol: "noobot.semantic-transfer",
            version: TRANSFER_VERSION,
            transferId: "transfer-tool-1",
            presentationMessageId: "message-tool-1",
            identity: {
              sessionId: "s1",
              turnScopeId: "t1",
              runId: "r1",
              producer: { type: "tool", id: "call_1" },
            },
            direction: "output",
            payload: { mode: "direct", content: "tool result" },
            intent: {
              source: "tool",
              reason: TRANSFER_REASON.SEMANTIC_TRANSFER_TOOL_RESULT,
              scenario: "tool",
              strategy: "tool_output",
            },
            meta: {},
          },
        ],
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
    appendTurns: async (payload = {}) => {
      appendedTurns.push(...payload.turns);
      return { appended: true, reason: "", turns: payload.turns };
    },
  };
  const persister = new SessionTurnPersister({ session });
  const envelope = {
    protocol: "noobot.semantic-transfer",
    version: TRANSFER_VERSION,
    transferId: "transfer-final",
    presentationMessageId: "message-final",
    identity: {
      sessionId: "s1",
      turnScopeId: "t1",
      runId: "r1",
      producer: { type: "tool", id: "call-final" },
    },
    direction: "output",
    payload: {
      mode: "attachment",
      attachments: [
        {
          identity: { attachmentId: "att-final", sessionId: "s1", attachmentSource: "model" },
          role: "primary",
          name: "final.md",
          mimeType: "text/markdown",
        },
      ],
    },
    intent: {
      source: "tool",
      reason: "semantic_transfer_tool_result",
      scenario: "tool",
      strategy: "tool_result_text",
    },
    meta: {},
  };

  await persister.appendAgentMessages({
    userId: "u1",
    sessionId: "s1",
    messages: [
      {
        role: "assistant",
        type: "message",
        content: "done",
        transferEnvelopes: [envelope],
      },
    ],
    dialogProcessId: "dp1",
  });

  assert.equal(appendedTurns.length, 1);
  assert.equal(appendedTurns[0].attachmentMetas, undefined);
  assert.equal("attachments" in appendedTurns[0], false);
  assert.equal("transferEnvelopes" in appendedTurns[0], true);
  assert.equal(
    appendedTurns[0].transferEnvelopes?.[0]?.payload?.attachments?.[0]?.identity?.attachmentId,
    "att-final",
  );
  assert.equal(appendedTurns[0].transferEnvelopes?.length, 1);
});

test("SessionTurnPersister persists canonical plugin metadata without old concrete-plugin fields", async () => {
  const appendedTurns = [];
  const executionLogs = [];
  const session = {
    appendExecutionLog: async (payload = {}) => {
      executionLogs.push(payload);
    },
    appendTurns: async (payload = {}) => {
      appendedTurns.push(...payload.turns);
      return { appended: true, reason: "", turns: payload.turns };
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
    appendTurns: async (payload = {}) => {
      appendedTurns.push(...payload.turns);
      return { appended: true, reason: "", turns: payload.turns };
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

test("appendAgentMessages keeps relayCorrelationId on persisted injected turns", async () => {
  const appendedTurns = [];
  const persister = new SessionTurnPersister({
    session: {
      appendExecutionLog: async () => {},
      appendTurns: async (payload = {}) => {
        appendedTurns.push(...payload.turns);
        return { appended: true, reason: "", turns: payload.turns };
      },
    },
  });

  await persister.appendAgentMessages({
    userId: "u1",
    sessionId: "s1",
    messages: [
      {
        messageUid: "sm_relay",
        role: "user",
        type: "message",
        content: "[来自harness外部模型输出/guidance]\n分析中",
        injectedMessage: true,
        injectedBy: "harness-plugin",
        relayCorrelationId: "rc_fixture_1",
      },
      {
        messageUid: "sm_plain",
        role: "assistant",
        type: "message",
        content: "done",
      },
    ],
    dialogProcessId: "dp1",
  });

  assert.equal(appendedTurns.length, 2);
  assert.equal(appendedTurns[0].relayCorrelationId, "rc_fixture_1");
  assert.equal(appendedTurns[1].relayCorrelationId, "");
});

test("appendAgentMessages keeps canonical user interjection time and sequence", async () => {
  const appendedTurns = [];
  const persister = new SessionTurnPersister({
    session: {
      appendExecutionLog: async () => {},
      appendTurns: async (payload = {}) => {
        appendedTurns.push(...payload.turns);
        return { appended: true, reason: "", turns: payload.turns };
      },
    },
  });

  await persister.appendAgentMessages({
    userId: "u1",
    sessionId: "s1",
    messages: [
      {
        messageUid: "interjection-uid-command-1",
        role: "user",
        type: "message",
        content: "accepted constraint",
        injectedMessage: true,
        injectedMessageType: "noobot.user_interjection",
        interjectionSequence: 1,
        ts: "2026-09-18T01:00:00.000Z",
      },
    ],
    dialogProcessId: "dp1",
    turnScopeId: "turn-1",
  });

  assert.equal(appendedTurns[0].interjectionSequence, 1);
  assert.equal(appendedTurns[0].ts, "2026-09-18T01:00:00.000Z");
});
