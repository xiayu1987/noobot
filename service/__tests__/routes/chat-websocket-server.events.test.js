/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import test from "node:test";
import assert from "node:assert/strict";
import { startServerWithWs, closeServer, callChatWs } from "./chat-websocket-server.test-helpers.js";

test("chat-websocket-server publishes committed child lifecycle under the child session identity", async () => {
  const server = await startServerWithWs({
    runSession: async ({ eventListener }) => {
      eventListener.onEvent({
        event: "turn_lifecycle_committed",
        data: {
          userId: "u1",
          sessionId: "child-session",
          parentSessionId: "parent-session",
          turnScopeId: "child-turn",
          dialogProcessId: "child-dialog",
          commandId: "child-command",
          eventType: "turn.processing_started",
          turn: {
            turnScopeId: "child-turn",
            dialogProcessId: "child-dialog",
            commandId: "child-command",
            revision: 2,
            sequence: 2,
            phase: "processing",
            state: "processing",
            action: "send",
            executionState: "sending",
            updatedAt: "2026-01-01T00:00:00.000Z",
          },
        },
      });
      return { sessionId: "parent-session", dialogProcessId: "parent-dialog", answer: "done", messages: [], traces: [], executionLogs: [] };
    },
  });
  try {
    const events = await callChatWs({ port: server.address().port, payload: {
      userId: "u1", sessionId: "parent-session", message: "hello", turnScopeId: "parent-turn",
    } });
    const child = events.find((item) => item?.event === "turn_lifecycle" && item?.data?.sessionId === "child-session");
    assert.equal(child?.data?.parentSessionId, "parent-session");
    assert.equal(child?.data?.turnScopeId, "child-turn");
    assert.equal(child?.data?.revision, 2);
    assert.equal(events.some((item) => item?.event === "turn_lifecycle_committed"), false);
  } finally {
    await closeServer(server);
  }
});

test("chat-websocket-server: streaming=false 仍推系统事件且不推 delta", async () => {
  const server = await startServerWithWs({
    runSession: async ({ eventListener }) => {
      eventListener?.onEvent?.({
        event: "tool_call_start",
        data: { tool: "mock_tool", args: { a: 1 }, dialogProcessId: "dp-1" },
      });
      eventListener?.onEvent?.({
        event: "llm_delta",
        data: { text: "delta-token", dialogProcessId: "dp-1" },
      });
      eventListener?.onEvent?.({
        event: "tool_call_end",
        data: { tool: "mock_tool", result: "ok", dialogProcessId: "dp-1" },
      });
      return {
        sessionId: "s1",
        dialogProcessId: "dp-1",
        answer: "done",
        messages: [],
        traces: [],
        executionLogs: [],
      };
    },
  });
  try {
    const { port } = server.address();
    const events = await callChatWs({
      port,
      payload: {
        userId: "u1",
        sessionId: "s1",
        message: "hello",
        config: { streaming: false, locale: "zh-CN" },
      },
    });
    const names = events.map((item) => String(item?.event || ""));
    assert.equal(names.includes("tool_call_start"), true);
    assert.equal(names.includes("tool_call_end"), true);
    assert.equal(names.includes("delta"), false);
    assert.equal(names.includes("done"), true);
  } finally {
    await closeServer(server);
  }
});

test("chat-websocket-server: parsed attachment updates and delta events keep request turnScopeId", async () => {
  const server = await startServerWithWs({
    runSession: async ({ eventListener }) => {
      eventListener?.onEvent?.({
        event: "attachment_parsed",
        data: {
          dialogProcessId: "dp-attachments",
          sessionId: "sub-session-from-parser",
          attachments: [{ id: "att-1", name: "a.txt" }],
        },
      });
      eventListener?.onEvent?.({
        event: "llm_delta",
        data: { text: "root-token", dialogProcessId: "dp-root" },
      });
      eventListener?.onEvent?.({
        event: "llm_delta",
        data: {
          text: "sub-token",
          dialogProcessId: "dp-subagent",
          sessionId: "sub-session-1",
          subAgentSessionId: "sub-session-1",
          subAgentCall: true,
        },
      });
      return {
        sessionId: "s1",
        dialogProcessId: "dp-root",
        answer: "done",
        messages: [],
        traces: [],
        executionLogs: [],
      };
    },
  });
  try {
    const { port } = server.address();
    const events = await callChatWs({
      port,
      payload: {
        userId: "u1",
        sessionId: "s1",
        message: "hello",
        turnScopeId: "turn-parent",
        config: { streaming: true, locale: "zh-CN" },
      },
    });

    const attachmentsEvent = events.find((item) => item?.event === "attachment_parsed");
    assert.equal(attachmentsEvent?.data?.sessionId, "s1");
    assert.equal(attachmentsEvent?.data?.turnScopeId, "turn-parent");
    assert.deepEqual(attachmentsEvent?.data?.attachments, [{ id: "att-1", name: "a.txt" }]);

    const deltaEvent = events.find((item) => item?.event === "delta");
    assert.equal(deltaEvent?.data?.turnScopeId, "turn-parent");

    const subagentDeltaEvent = events.find(
      (item) => item?.event === "subagent_llm_delta",
    );
    assert.equal(subagentDeltaEvent?.data?.sessionId, "s1");
    assert.equal(subagentDeltaEvent?.data?.dialogProcessId, "dp-root");
    assert.equal(subagentDeltaEvent?.data?.childSessionId, "sub-session-1");
    assert.equal(subagentDeltaEvent?.data?.childDialogProcessId, "dp-subagent");
    assert.equal(subagentDeltaEvent?.data?.conversationStateOwner, "parent_agent");
    assert.equal(subagentDeltaEvent?.data?.turnScopeId, "turn-parent");

    const doneEvent = events.find((item) => item?.event === "done");
    assert.equal(doneEvent?.data?.turnScopeId, "turn-parent");
  } finally {
    await closeServer(server);
  }
});

test("chat-websocket-server: child run system events are owned by parent dialog state", async () => {
  const server = await startServerWithWs({
    runSession: async ({ eventListener }) => {
      eventListener?.onEvent?.({
        event: "tool_call_start",
        data: {
          dialogProcessId: "dp-parent",
          sessionId: "s1",
          tool: "process_content_task",
        },
      });
      eventListener?.onEvent?.({
        event: "session_starting",
        data: {
          dialogProcessId: "dp-child",
          sessionId: "child-session-1",
          parentSessionId: "s1",
        },
      });
      eventListener?.onEvent?.({
        event: "workspace_ready",
        data: {
          dialogProcessId: "dp-child",
          sessionId: "child-session-1",
          parentSessionId: "s1",
        },
      });
      eventListener?.onEvent?.({
        event: "tool_call_start",
        data: {
          dialogProcessId: "dp-child",
          parentDialogProcessId: "dp-parent",
          sessionId: "child-session-1",
          parentSessionId: "s1",
          tool: "parse_attachment",
        },
      });
      return {
        sessionId: "s1",
        dialogProcessId: "dp-parent",
        answer: "done",
        messages: [],
        traces: [],
        executionLogs: [],
      };
    },
  });
  try {
    const { port } = server.address();
    const events = await callChatWs({
      port,
      payload: {
        userId: "u1",
        sessionId: "s1",
        message: "hello",
        config: { streaming: true, locale: "zh-CN" },
      },
    });

    const childSystemEvents = events.filter((item) =>
      item?.data?.childSessionId === "child-session-1" &&
      ["subagent_session_starting", "subagent_workspace_ready", "subagent_tool_call_start"]
        .includes(item?.event),
    );
    assert.equal(childSystemEvents.length, 3);
    assert.deepEqual(
      childSystemEvents.map((item) => item?.data?.dialogProcessId),
      ["dp-parent", "dp-parent", "dp-parent"],
    );
    assert.deepEqual(
      childSystemEvents.map((item) => item?.data?.childDialogProcessId),
      ["dp-child", "dp-child", "dp-child"],
    );
    assert.deepEqual(
      childSystemEvents.map((item) => item?.data?.childSessionId),
      ["child-session-1", "child-session-1", "child-session-1"],
    );
    assert.equal(
      childSystemEvents.every(
        (item) =>
          item?.data?.subAgentCall === true &&
          item?.data?.conversationStateOwner === "parent_agent",
      ),
      true,
    );
    assert.equal(
      events.some((item) => item?.data?.dialogProcessId === "dp-child"),
      false,
    );
    const doneEvent = events.find((item) => item?.event === "done");
    assert.equal(doneEvent?.data?.dialogProcessId, "dp-parent");
  } finally {
    await closeServer(server);
  }
});

test("chat-websocket-server preserves authoritative identity for workflow child tool events", async () => {
  const identity = {
    envelopeKind: "noobot.message_event",
    envelopeVersion: 2,
    sessionId: "workflow-child-1",
    parentSessionId: "s1",
    dialogProcessId: "workflow-child-dialog",
    parentDialogProcessId: "dp-parent",
    turnScopeId: "workflow-child-turn",
    messageId: "msg-workflow-1",
    presentationMessageId: "msg-workflow-presentation-1",
    scope: "sub_session",
    workflowRunId: "workflow-1",
    nodeExecutionId: "node-1",
    timestamp: "2026-01-01T00:00:00.000Z",
  };
  const server = await startServerWithWs({
    runSession: async ({ eventListener }) => {
      eventListener?.onEvent?.({
        event: "main_model_content",
        data: {
          ...identity,
          eventId: "evt-thinking",
          eventType: "main_model_content",
          sequence: 1,
          text: "```mermaid\ngraph TD; A-->B\n```",
        },
      });
      eventListener?.onEvent?.({
        event: "tool_call_end",
        data: {
          ...identity,
          eventId: "evt-tool-result",
          eventType: "tool_call_end",
          sequence: 2,
          toolCallId: "call-1",
          tool: "read_file",
          result: { ok: true },
        },
      });
      return {
        sessionId: "s1",
        dialogProcessId: "dp-parent",
        answer: "done",
        messages: [],
        traces: [],
        executionLogs: [],
      };
    },
  });
  try {
    const events = await callChatWs({
      port: server.address().port,
      payload: {
        userId: "u1",
        sessionId: "s1",
        message: "hello",
        turnScopeId: "parent-turn",
        config: { streaming: true, locale: "zh-CN" },
      },
    });
    const messageEvents = events.filter((item) => item?.event === "subagent_message_event");
    const thinking = messageEvents.find((item) => item?.data?.event?.eventType === "main_model_content");
    const toolResult = messageEvents.find((item) => item?.data?.event?.eventType === "tool_call_end");
    assert.deepEqual(thinking?.data?.event, {
      ...identity,
      eventId: "evt-thinking",
      eventType: "main_model_content",
      sequence: 1,
      text: "```mermaid\ngraph TD; A-->B\n```",
    });
    assert.deepEqual(toolResult?.data?.event, {
      ...identity,
      eventId: "evt-tool-result",
      eventType: "tool_call_end",
      sequence: 2,
      toolCallId: "call-1",
      tool: "read_file",
      result: { ok: true },
    });
    assert.equal(toolResult?.data?.route?.scope, "sub_session");
    assert.equal(toolResult?.data?.route?.workflowRunId, "workflow-1");
    assert.equal(toolResult?.data?.route?.nodeExecutionId, "node-1");
    assert.equal(Object.hasOwn(toolResult?.data?.route || {}, "messageId"), false);
    assert.equal(toolResult?.data?.channelKind, "message_event");
    assert.equal(toolResult?.data?.channelVersion, 1);
    assert.equal(toolResult?.data?.sessionId, identity.sessionId);
    assert.equal(toolResult?.data?.dialogProcessId, identity.dialogProcessId);
    assert.equal(toolResult?.data?.turnScopeId, identity.turnScopeId);
    assert.equal(toolResult?.data?.seq > 0, true);
    assert.equal(toolResult?.data?.event?.sequence, 2);
  } finally {
    await closeServer(server);
  }
});

test("chat-websocket-server: streaming=true 保持 delta 推送", async () => {
  const server = await startServerWithWs({
    runSession: async ({ eventListener }) => {
      eventListener?.onEvent?.({
        event: "llm_delta",
        data: { text: "delta-token", dialogProcessId: "dp-1" },
      });
      return {
        sessionId: "s1",
        dialogProcessId: "dp-1",
        answer: "done",
        messages: [],
        traces: [],
        executionLogs: [],
      };
    },
  });
  try {
    const { port } = server.address();
    const events = await callChatWs({
      port,
      payload: {
        userId: "u1",
        sessionId: "s1",
        message: "hello",
        config: { streaming: true, locale: "zh-CN" },
      },
    });
    const names = events.map((item) => String(item?.event || ""));
    assert.equal(names.includes("delta"), true);
    assert.equal(names.includes("done"), true);
  } finally {
    await closeServer(server);
  }
});

test("chat-websocket-server: global streaming=true should allow delta", async () => {
  const server = await startServerWithWs({
    bot: {
      globalConfig: { streaming: true },
      runSession: async ({ eventListener }) => {
        eventListener?.onEvent?.({
          event: "llm_delta",
          data: { text: "delta-token", dialogProcessId: "dp-1" },
        });
        return {
          sessionId: "s1",
          dialogProcessId: "dp-1",
          answer: "done",
          messages: [],
          traces: [],
          executionLogs: [],
        };
      },
    },
  });
  try {
    const { port } = server.address();
    const events = await callChatWs({
      port,
      payload: {
        userId: "u1",
        sessionId: "s1",
        message: "hello",
        config: { locale: "zh-CN" },
      },
    });
    const names = events.map((item) => String(item?.event || ""));
    assert.equal(names.includes("delta"), true);
    assert.equal(names.includes("done"), true);
  } finally {
    await closeServer(server);
  }
});


test("chat-websocket-server: explicit streaming=false should override global streaming=true", async () => {
  const server = await startServerWithWs({
    bot: {
      globalConfig: { streaming: true },
      runSession: async ({ eventListener }) => {
        eventListener?.onEvent?.({
          event: "llm_delta",
          data: { text: "delta-token", dialogProcessId: "dp-1" },
        });
        return {
          sessionId: "s1",
          dialogProcessId: "dp-1",
          answer: "done",
          messages: [],
          traces: [],
          executionLogs: [],
        };
      },
    },
  });
  try {
    const { port } = server.address();
    const events = await callChatWs({
      port,
      payload: {
        userId: "u1",
        sessionId: "s1",
        message: "hello",
        config: { streaming: false, locale: "zh-CN" },
      },
    });
    const names = events.map((item) => String(item?.event || ""));
    assert.equal(names.includes("delta"), false);
    assert.equal(names.includes("done"), true);
  } finally {
    await closeServer(server);
  }
});
