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
} from "../src/task/summary.js";
import { recoverContextTaskSummaryToolResult } from "../src/task/summary-context.js";
import { FLOW_CONTROL_ROLE, createFlowControlContextPolicy } from "../src/tool/context-policy.js";

const boundaryPolicy = createFlowControlContextPolicy(FLOW_CONTROL_ROLE.CHECKPOINT_BOUNDARY);

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

test("task summary context recovery accepts only a classified canonical v1 boundary receipt", () => {
  const receipt = createTaskSummaryReceipt(valid);
  const content = JSON.stringify({
    toolName: "task_summary",
    protocolVersion: 1,
    summary: receipt,
    transferEnvelopes: [{ protocol: "noobot.semantic-transfer", version: 1 }],
  });
  const recovered = recoverContextTaskSummaryToolResult({
    messageUid: "summary-result-message",
    role: "tool",
    type: "tool_result",
    content,
    tool_call_id: "summary-call-1",
    contextPolicy: boundaryPolicy,
    lc_kwargs: {
      role: "tool",
      tool_call_id: "summary-call-1",
      contextPolicy: boundaryPolicy,
    },
    additional_kwargs: {
      dialogProcessId: "dialog-1",
      turnScopeId: "turn-1",
      tool_call_id: "summary-call-1",
      contextPolicy: boundaryPolicy,
    },
  });
  assert.equal(recovered.role, "user");
  assert.equal(recovered.content, content);
  assert.equal(recovered.phaseSummaryMemory, true);
  assert.equal(recovered.messageUid, "summary-result-message");
  assert.equal(recovered.tool_call_id, undefined);
  assert.equal(recovered.type, undefined);
  assert.equal(recovered.contextPolicy, undefined);
  assert.equal(recovered.lc_kwargs, undefined);
  assert.equal(recovered.original_tool_call_id, "summary-call-1");
  assert.deepEqual(recovered.additional_kwargs, {
    noobotMessageId: "summary-result-message",
    dialogProcessId: "dialog-1",
    turnScopeId: "turn-1",
    noobotInternalMessageType: "phase_summary_memory",
    recoveredFromUnpairedTaskSummary: true,
    original_tool_call_id: "summary-call-1",
  });

  assert.equal(
    recoverContextTaskSummaryToolResult({
      role: "tool",
      content: JSON.stringify({ toolName: "task_summary", summaryContent: valid }),
      contextPolicy: boundaryPolicy,
    }),
    null,
  );
  assert.equal(
    recoverContextTaskSummaryToolResult({
      role: "tool",
      content,
      tool_call_id: "unclassified-call",
    }),
    null,
  );
});

for (const [name, content] of [
  ["missing header", valid.replace("NOOBOT_TASK_SUMMARY/1\n", "")],
  ["missing section", valid.replace("[ABSTRACT]\n完成协议实现。\n", "")],
  [
    "wrong order",
    valid.replace(
      "[ABSTRACT]\n完成协议实现。\n[DETAILS]\n修改唯一解析器并完成测试。",
      "[DETAILS]\n修改唯一解析器并完成测试。\n[ABSTRACT]\n完成协议实现。",
    ),
  ],
  ["duplicate section", `${valid}\n[STATE]\nCONTINUE`],
  [
    "unknown section",
    valid.replace("修改唯一解析器并完成测试。", "修改唯一解析器并完成测试。\n[OTHER]\n非法内容"),
  ],
  ["invalid state", valid.replace("CONTINUE", "RUNNING")],
  ["empty section", valid.replace("完成协议实现。", "")],
]) {
  test(`task summary protocol rejects ${name}`, () => {
    assert.throws(() => parseTaskSummaryContent(content), /invalid NOOBOT_TASK_SUMMARY\/1 content/);
  });
}
