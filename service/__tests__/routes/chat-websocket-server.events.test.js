import test from "node:test";
import assert from "node:assert/strict";
import { startServerWithWs, closeServer, callChatWs } from "./chat-websocket-server.test-helpers.js";

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
    assert.equal(names.includes("thinking"), true);
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
      (item) => item?.event === "thinking" && item?.data?.rawEvent === "subagent_llm_delta",
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

    const childSystemEvents = events.filter(
      (item) =>
        item?.event === "thinking" &&
        item?.data?.childSessionId === "child-session-1" &&
        ["session_starting", "workspace_ready", "tool_call_start"].includes(item?.data?.rawEvent),
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
      events.some((item) => item?.event === "thinking" && item?.data?.dialogProcessId === "dp-child"),
      false,
    );
    const doneEvent = events.find((item) => item?.event === "done");
    assert.equal(doneEvent?.data?.dialogProcessId, "dp-parent");
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
