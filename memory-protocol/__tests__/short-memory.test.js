/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import test from "node:test";
import assert from "node:assert/strict";
import { CONTEXT_INJECTED_MESSAGE_TYPE } from "@noobot/context-protocol/message/injected-types";
import {
  excludeShortMemoryItemsBySessionIds,
  sortShortMemoryItems,
  toShortMemoryRecords,
} from "../src/short-memory.js";

function injected(type, content) {
  return { role: "user", content, injectedMessage: true, injectedMessageType: type };
}

test("short memory keeps only natural user and assistant text", () => {
  const records = toShortMemoryRecords([
    { role: "user", content: "真实问题" },
    injected(CONTEXT_INJECTED_MESSAGE_TYPE.TASK_CHECK_PROMPT, "已达到周期任务检查阈值"),
    injected(CONTEXT_INJECTED_MESSAGE_TYPE.PHASE_SUMMARY_PROMPT, "阶段小结"),
    injected(CONTEXT_INJECTED_MESSAGE_TYPE.HELP_TOOL_LOOP_PROMPT, "工具循环已执行"),
    { role: "assistant", type: "tool_call", content: "calling" },
    { role: "tool", content: "tool result" },
    { role: "assistant", content: "  " },
    { role: "assistant", content: "回答" },
  ]);
  assert.deepEqual(records, [
    { role: "user", content: "真实问题" },
    { role: "assistant", content: "回答" },
  ]);
});

test("short memory items sort by createdAt and drop deleted sessions", () => {
  const items = [
    { sessionId: "b", createdAt: "2026-01-02T00:00:00Z" },
    { sessionId: "a", createdAt: "2026-01-01T00:00:00Z" },
    { sessionId: "c", parentSessionId: "a", createdAt: "2026-01-03T00:00:00Z" },
  ];
  assert.deepEqual(
    sortShortMemoryItems(items).map((item) => item.sessionId),
    ["a", "b", "c"],
  );
  assert.deepEqual(
    excludeShortMemoryItemsBySessionIds(items, [" a "]).map((item) => item.sessionId),
    ["b"],
  );
});
