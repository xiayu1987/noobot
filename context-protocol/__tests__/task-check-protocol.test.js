/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import assert from "node:assert/strict";
import test from "node:test";
import {
  createTaskCheckReceipt,
  parseTaskCheckContent,
  parseTaskCheckReceipt,
} from "../src/task-check-protocol.js";

const validContent = [
  "NOOBOT_TASK_CHECK/1",
  "[STATE]",
  "CONTINUE",
  "[ABSTRACT]",
  "任务仍按目标推进。",
  "[DETAILS]",
  "已完成协议层，当前无偏移，下一阶段验证运行时。",
  "[NEXT_ACTION]",
  "继续运行状态机测试。",
].join("\n");

test("task check protocol parses one strict text shape and creates a minimal receipt", () => {
  const parsed = parseTaskCheckContent(validContent);
  const receipt = createTaskCheckReceipt(parsed);
  assert.equal(parsed.details, "已完成协议层，当前无偏移，下一阶段验证运行时。");
  assert.deepEqual(Object.keys(receipt).sort(), ["abstract", "contentHash", "nextAction", "state"]);
  assert.match(receipt.contentHash, /^sha256:[a-f0-9]{64}$/);
  assert.deepEqual(parseTaskCheckReceipt(receipt), receipt);
});

test("task check protocol rejects free text and receipt extensions", () => {
  assert.throws(() => parseTaskCheckContent("任务正常"), /NOOBOT_TASK_CHECK\/1/);
  const receipt = createTaskCheckReceipt(validContent);
  assert.throws(() => parseTaskCheckReceipt({ ...receipt, details: "duplicate" }), /exactly/);
});
