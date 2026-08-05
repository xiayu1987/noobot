/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import test from "node:test";
import assert from "node:assert/strict";
import {
  TASK_SUMMARY_STATE,
  createTaskSummaryReceipt,
  parseTaskSummaryContent,
  parseTaskSummaryReceipt,
} from "../src/task-summary-protocol.js";
import { recoverContextTaskSummaryToolResult } from "../src/message-codec.js";

const valid = [
  "NOOBOT_TASK_SUMMARY/1",
  "[STATE]",
  "CONTINUE",
  "[ABSTRACT]",
  "完成协议实现。",
  "[DETAILS]",
  "修改唯一解析器并完成测试。",
  "[NEXT_ACTION]",
  "继续运行浏览器验证。",
].join("\n");

test("task summary protocol parses the single canonical text representation", () => {
  const parsed = parseTaskSummaryContent(valid);
  assert.equal(parsed.state, TASK_SUMMARY_STATE.CONTINUE);
  assert.equal(parsed.abstract, "完成协议实现。");
  assert.equal(parsed.details, "修改唯一解析器并完成测试。");
  assert.equal(parsed.nextAction, "继续运行浏览器验证。");
  assert.deepEqual(createTaskSummaryReceipt(parsed), {
    state: "CONTINUE",
    abstract: "完成协议实现。",
    nextAction: "继续运行浏览器验证。",
    contentHash: createTaskSummaryReceipt(valid).contentHash,
  });
  assert.match(createTaskSummaryReceipt(parsed).contentHash, /^sha256:[a-f0-9]{64}$/);
});

test("task summary receipt accepts only the four canonical derived fields", () => {
  const receipt = createTaskSummaryReceipt(valid);
  assert.deepEqual(parseTaskSummaryReceipt(receipt), receipt);
  assert.throws(
    () => parseTaskSummaryReceipt({ ...receipt, details: "duplicate full content" }),
    /must contain exactly/,
  );
});

test("task summary context recovery accepts only the canonical v1 receipt", () => {
  const receipt = createTaskSummaryReceipt(valid);
  const content = JSON.stringify({
    toolName: "task_summary",
    protocolVersion: 1,
    summary: receipt,
    transferEnvelopes: [{ protocol: "noobot.semantic-transfer", version: 1 }],
  });
  const recovered = recoverContextTaskSummaryToolResult({
    role: "tool",
    content,
    tool_call_id: "summary-call-1",
  });
  assert.equal(recovered.role, "user");
  assert.equal(recovered.content, content);
  assert.equal(recovered.phaseSummaryMemory, true);
  assert.equal(recovered.tool_call_id, undefined);
  assert.equal(recovered.original_tool_call_id, "summary-call-1");

  assert.equal(recoverContextTaskSummaryToolResult({
    role: "tool",
    content: JSON.stringify({ toolName: "task_summary", summaryContent: valid }),
  }), null);
});

for (const [name, content] of [
  ["missing header", valid.replace("NOOBOT_TASK_SUMMARY/1\n", "")],
  ["missing section", valid.replace("[ABSTRACT]\n完成协议实现。\n", "")],
  ["wrong order", valid.replace("[ABSTRACT]\n完成协议实现。\n[DETAILS]\n修改唯一解析器并完成测试。", "[DETAILS]\n修改唯一解析器并完成测试。\n[ABSTRACT]\n完成协议实现。")],
  ["duplicate section", `${valid}\n[STATE]\nCONTINUE`],
  ["unknown section", valid.replace("修改唯一解析器并完成测试。", "修改唯一解析器并完成测试。\n[OTHER]\n非法内容")],
  ["invalid state", valid.replace("CONTINUE", "RUNNING")],
  ["empty section", valid.replace("完成协议实现。", "")],
]) {
  test(`task summary protocol rejects ${name}`, () => {
    assert.throws(() => parseTaskSummaryContent(content), /invalid NOOBOT_TASK_SUMMARY\/1 content/);
  });
}
