/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
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

test("getRecentSessionMessages preserves legacy history without dialog identity", async () => {
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
  });

  assert.deepEqual(result, messages);
});

test("getRecentSessionMessages keeps explicit dialog group content in original order", async () => {
  const messages = [
    { role: "user", content: "please continue", dialogProcessId: "dlg_1" },
    { role: "assistant", content: "", dialogProcessId: "dlg_1" },
    {
      role: "assistant",
      content: "",
      dialogProcessId: "dlg_1",
      tool_calls: [{ id: "call_1", function: { name: "task_summary", arguments: "{}" } }],
    },
    {
      role: "tool",
      content: "{\"toolName\":\"task_summary\",\"ok\":true}",
      dialogProcessId: "dlg_1",
      tool_call_id: "call_1",
    },
  ];
  const service = createSessionContextService(messages);
  const result = await service.getRecentSessionMessages({
    userId: "u1",
    sessionId: "s1",
  });

  assert.deepEqual(
    result.map((messageItem) => messageItem.role),
    ["user", "assistant", "assistant", "tool"],
  );
});

test("getRecentSessionMessages respects summarized filter before window normalization", async () => {
  const messages = [
    { role: "user", content: "keep me", summarized: false, dialogProcessId: "dlg_1" },
    { role: "assistant", content: "old", summarized: true, dialogProcessId: "dlg_1" },
    { role: "assistant", content: "new", summarized: false, dialogProcessId: "dlg_1" },
  ];
  const service = createSessionContextService(messages);
  const result = await service.getRecentSessionMessages({
    userId: "u1",
    sessionId: "s1",
  });

  assert.deepEqual(
    result.map((messageItem) => messageItem.content),
    ["keep me", "new"],
  );
});

test("getRecentSessionMessages keeps latest fixed dialog rounds and all unsummarized injected messages", async () => {
  const messages = [
    { role: "user", content: "first real question", dialogProcessId: "dlg_1" },
    {
      role: "user",
      content: "[Relay from plugin/planning]\nold plan 1",
      dialogProcessId: "dlg_1",
    },
    { role: "assistant", content: "first real answer", dialogProcessId: "dlg_1" },
    { role: "user", content: "second real question", dialogProcessId: "dlg_2" },
    {
      role: "user",
      content: "[Relay from plugin/planning_revision]\nold plan 2",
      dialogProcessId: "dlg_2",
    },
    {
      role: "user",
      content: "[Relay from plugin/planning_revision]\nlatest plan 2",
      dialogProcessId: "dlg_2",
    },
    { role: "assistant", content: "second real answer", dialogProcessId: "dlg_2" },
    { role: "user", content: "third real question", dialogProcessId: "dlg_3" },
    {
      role: "user",
      content: "[Relay from plugin/planning]\ncurrent plan",
      dialogProcessId: "dlg_3",
    },
    { role: "assistant", content: "third real answer", dialogProcessId: "dlg_3" },
  ];
  const service = createSessionContextService(messages);
  const result = await service.getRecentSessionMessages({
    userId: "u1",
    sessionId: "s1",
  });

  assert.deepEqual(
    result.map((messageItem) => messageItem.content),
    [
      "first real question",
      "[Relay from plugin/planning]\nold plan 1",
      "first real answer",
      "second real question",
      "[Relay from plugin/planning_revision]\nold plan 2",
      "[Relay from plugin/planning_revision]\nlatest plan 2",
      "second real answer",
      "third real question",
      "[Relay from plugin/planning]\ncurrent plan",
      "third real answer",
    ],
  );
});

test("getRecentSessionMessages excludes current turn user when reusing an edited turn", async () => {
  const messages = [
    {
      role: "user",
      content: "上一轮问题",
      dialogProcessId: "dlg_old",
      turnScopeId: "client-turn:old",
    },
    {
      role: "assistant",
      content: "上一轮回答",
      dialogProcessId: "dlg_old",
      turnScopeId: "client-turn:old",
    },
    {
      role: "user",
      content: "全仓回归测试",
      dialogProcessId: "dlg_current",
      turnScopeId: "client-turn:mqrt1icf:lxcfigpr",
    },
    {
      role: "assistant",
      content: "旧的待替换回答",
      dialogProcessId: "dlg_current",
      turnScopeId: "client-turn:mqrt1icf:lxcfigpr",
    },
  ];
  const service = createSessionContextService(messages);
  const result = await service.getRecentSessionMessages({
    userId: "u1",
    sessionId: "s1",
    currentTurnScopeId: "client-turn:mqrt1icf:lxcfigpr",
  });

  assert.deepEqual(
    result.map((messageItem) => messageItem.content),
    ["上一轮问题", "上一轮回答"],
  );
});

test("getContextRecords passes current turn filter through recent history", async () => {
  const messages = [
    {
      role: "user",
      content: "历史问题",
      dialogProcessId: "dlg_old",
      turnScopeId: "client-turn:old",
    },
    {
      role: "assistant",
      content: "历史回答",
      dialogProcessId: "dlg_old",
      turnScopeId: "client-turn:old",
    },
    {
      role: "user",
      content: "全仓回归测试",
      dialogProcessId: "dlg_current",
      turnScopeId: "client-turn:mqrt1icf:lxcfigpr",
    },
    {
      role: "assistant",
      content: "旧回答",
      dialogProcessId: "dlg_current",
      turnScopeId: "client-turn:mqrt1icf:lxcfigpr",
    },
  ];
  const service = createSessionContextService(messages);
  const result = await service.getContextRecords({
    userId: "u1",
    sessionId: "s1",
    currentTurnScopeId: "client-turn:mqrt1icf:lxcfigpr",
  });

  assert.deepEqual(
    result.map((messageItem) => messageItem.content),
    ["历史问题", "历史回答"],
  );
});

test("getRecentSessionMessages selects fixed latest previous dialogProcessId rounds", async () => {
  const messages = [];
  for (const id of ["dlg_1", "dlg_2", "dlg_3", "dlg_4", "dlg_current"]) {
    messages.push({
      role: "user",
      content: `${id} user`,
      dialogProcessId: id,
      turnScopeId: `turn:${id}`,
    });
    if (id !== "dlg_current") {
      messages.push({
        role: "assistant",
        content: `${id} assistant`,
        dialogProcessId: id,
        turnScopeId: `turn:${id}`,
      });
    }
  }
  const service = createSessionContextService(messages);
  const result = await service.getRecentSessionMessages({
    userId: "u1",
    sessionId: "s1",
    currentDialogProcessId: "dlg_current",
    currentTurnScopeId: "turn:dlg_current",
  });

  assert.deepEqual(
    result.map((messageItem) => messageItem.content),
    [
      "dlg_1 user",
      "dlg_1 assistant",
      "dlg_2 user",
      "dlg_2 assistant",
      "dlg_3 user",
      "dlg_3 assistant",
      "dlg_4 user",
      "dlg_4 assistant",
    ],
  );
});

test("getContextRecords uses fixed latest dialog history", async () => {
  const messages = [
    { role: "user", content: "origin user", dialogProcessId: "dlg_1" },
    { role: "assistant", content: "old answer", dialogProcessId: "dlg_1" },
    {
      role: "assistant",
      content: "",
      taskStatus: "start",
      dialogProcessId: "dlg_2",
      tool_calls: [{ id: "call_run", function: { name: "execute_script", arguments: "{}" } }],
    },
    {
      role: "tool",
      content: "{\"toolName\":\"execute_script\",\"ok\":true}",
      tool_call_id: "call_run",
      dialogProcessId: "dlg_2",
    },
    { role: "user", content: "latest user", dialogProcessId: "dlg_3" },
  ];
  const service = createSessionContextService(messages);

  const result = await service.getContextRecords({
    userId: "u1",
    sessionId: "s1",
  });

  assert.deepEqual(
    result.map((messageItem) => messageItem.content),
    [
      "origin user",
      "old answer",
      "",
      "{\"toolName\":\"execute_script\",\"ok\":true}",
      "latest user",
    ],
  );
});

test("session context config always uses the central main history round limit", async () => {
  const service = createSessionContextService([]);

  const result = service._sessionContextConfig();

  assert.equal(result.historyRoundLimit, 5);
});
