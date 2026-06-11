import test from "node:test";
import assert from "node:assert/strict";

import { SessionContextService } from "../../../src/system-core/session/services/session-context-service.js";

function createSessionContextService(messages = [], { globalConfig = {} } = {}) {
  return new SessionContextService({
    globalConfig,
    sessionService: {
      async getSessionTurns() {
        return messages;
      },
    },
  });
}

test("getRecentSessionMessages drops orphan tool results after window slicing", async () => {
  const messages = [
    {
      role: "assistant",
      content: "",
      tool_calls: [{ id: "call_old", function: { name: "execute_script", arguments: "{}" } }],
    },
    {
      role: "tool",
      content: "{\"toolName\":\"execute_script\",\"ok\":true}",
      tool_call_id: "call_old",
    },
    {
      role: "user",
      content: "next task",
    },
    {
      role: "tool",
      content: "{\"toolName\":\"execute_script\",\"ok\":true}",
      tool_call_id: "call_old",
    },
  ];
  const service = createSessionContextService(messages);
  const result = await service.getRecentSessionMessages({
    userId: "u1",
    sessionId: "s1",
    limit: 2,
  });

  assert.equal(result.length, 1);
  assert.equal(result[0]?.role, "user");
  assert.equal(result.some((messageItem) => messageItem?.role === "tool"), false);
});

test("getRecentSessionMessages keeps a recent user anchor when window has no user", async () => {
  const messages = [
    { role: "user", content: "please continue" },
    { role: "assistant", content: "" },
    {
      role: "assistant",
      content: "",
      tool_calls: [{ id: "call_1", function: { name: "task_summary", arguments: "{}" } }],
    },
    {
      role: "tool",
      content: "{\"toolName\":\"task_summary\",\"ok\":true}",
      tool_call_id: "call_1",
    },
  ];
  const service = createSessionContextService(messages);
  const result = await service.getRecentSessionMessages({
    userId: "u1",
    sessionId: "s1",
    limit: 2,
  });

  assert.equal(result[0]?.role, "user");
  assert.equal(
    result.some(
      (messageItem) =>
        messageItem?.role === "user" &&
        messageItem?.phaseSummaryMemory === true &&
        String(messageItem?.original_tool_call_id || "") === "call_1",
    ),
    true,
  );
});

test("getRecentSessionMessages respects summarized filter before window normalization", async () => {
  const messages = [
    { role: "user", content: "keep me", summarized: false },
    { role: "assistant", content: "old", summarized: true },
    { role: "assistant", content: "new", summarized: false },
  ];
  const service = createSessionContextService(messages);
  const result = await service.getRecentSessionMessages({
    userId: "u1",
    sessionId: "s1",
    limit: 2,
  });

  assert.deepEqual(
    result.map((messageItem) => messageItem.content),
    ["keep me", "new"],
  );
});

test("getRecentSessionMessages filters old dialog injected messages before recent window", async () => {
  const messages = [
    { role: "user", content: "first real question", dialogProcessId: "dlg_1" },
    {
      role: "user",
      content: "[来自harness外部模型输出/planning]\nold plan 1",
      dialogProcessId: "dlg_1",
    },
    {
      role: "user",
      content: "[来自harness外部模型输出/planning_revision]\nold plan 2",
      dialogProcessId: "dlg_2",
    },
    { role: "assistant", content: "second real answer", dialogProcessId: "dlg_2" },
    {
      role: "user",
      content: "[来自harness外部模型输出/planning]\ncurrent plan",
      dialogProcessId: "dlg_3",
    },
    { role: "user", content: "third real question", dialogProcessId: "dlg_3" },
  ];
  const service = createSessionContextService(messages);
  const result = await service.getRecentSessionMessages({
    userId: "u1",
    sessionId: "s1",
    limit: 4,
    currentDialogProcessId: "dlg_3",
  });

  assert.deepEqual(
    result.map((messageItem) => messageItem.content),
    [
      "first real question",
      "second real answer",
      "[来自harness外部模型输出/planning]\ncurrent plan",
      "third real question",
    ],
  );
});

test("getMessagesSinceLastRunningTask uses the same normalization", async () => {
  const messages = [
    { role: "user", content: "origin user" },
    {
      role: "assistant",
      content: "",
      taskStatus: "start",
      tool_calls: [{ id: "call_run", function: { name: "execute_script", arguments: "{}" } }],
    },
    {
      role: "tool",
      content: "{\"toolName\":\"execute_script\",\"ok\":true}",
      tool_call_id: "call_run",
    },
    {
      role: "tool",
      content: "{\"toolName\":\"execute_script\",\"ok\":true}",
      tool_call_id: "orphan_call",
    },
  ];
  const service = createSessionContextService(messages);
  const result = await service.getMessagesSinceLastRunningTask({
    userId: "u1",
    sessionId: "s1",
  });

  assert.equal(result[0]?.role, "user");
  assert.equal(
    result.some(
      (messageItem) =>
        messageItem?.role === "tool" &&
        String(messageItem?.tool_call_id || "") === "orphan_call",
    ),
    false,
  );
});

test("getMessagesSinceLastCompletedTask uses the same normalization", async () => {
  const messages = [
    { role: "user", content: "origin user" },
    {
      role: "assistant",
      content: "",
      taskStatus: "completed",
      tool_calls: [{ id: "call_done", function: { name: "task_summary", arguments: "{}" } }],
    },
    {
      role: "tool",
      content: "{\"toolName\":\"task_summary\",\"ok\":true}",
      tool_call_id: "call_done",
    },
    {
      role: "tool",
      content: "{\"toolName\":\"task_summary\",\"ok\":true}",
      tool_call_id: "orphan_done",
    },
  ];
  const service = createSessionContextService(messages);
  const result = await service.getMessagesSinceLastCompletedTask({
    userId: "u1",
    sessionId: "s1",
  });

  assert.equal(result[0]?.role, "user");
  assert.equal(
    result.some(
      (messageItem) =>
        messageItem?.role === "user" &&
        messageItem?.phaseSummaryMemory === true &&
        String(messageItem?.original_tool_call_id || "") === "orphan_done",
    ),
    true,
  );
});

test("getContextRecords reads session context options from global config", async () => {
  const messages = [
    { role: "user", content: "origin user" },
    { role: "assistant", content: "old answer" },
    {
      role: "assistant",
      content: "",
      taskStatus: "start",
      tool_calls: [{ id: "call_run", function: { name: "execute_script", arguments: "{}" } }],
    },
    {
      role: "tool",
      content: "{\"toolName\":\"execute_script\",\"ok\":true}",
      tool_call_id: "call_run",
    },
  ];
  const service = createSessionContextService(messages, {
    globalConfig: {
      session: {
        use_last_running_task_range: true,
        recent_message_limit: 1,
      },
    },
  });

  const result = await service.getContextRecords({
    userId: "u1",
    sessionId: "s1",
  });

  assert.deepEqual(
    result.map((messageItem) => messageItem.content),
    ["origin user", "", "{\"toolName\":\"execute_script\",\"ok\":true}"],
  );
});

test("session context config resolves canonicalized global session options", async () => {
  const service = createSessionContextService([], {
    globalConfig: {
      session: {
        recent_message_limit: 2,
      },
    },
  });

  const result = service._sessionContextConfig();

  assert.equal(result.recentMessageLimit, 2);
});
