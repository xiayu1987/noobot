/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import test from "node:test";
import assert from "node:assert/strict";
import { migrateLegacyPhaseSummaryMessages } from "../src/phase-summary-migration.js";
import { SESSION_REPAIR_ERROR_CODE, SESSION_REPAIR_DATA_REJECTION_CODES } from "../src/errors.js";
import { createTaskSummaryReceipt } from "@noobot/context-protocol/task/summary";
import { CONTEXT_INJECTED_MESSAGE_TYPE } from "@noobot/context-protocol/message/injected-types";

const body =
  "NOOBOT_TASK_SUMMARY/1\n[STATE]\nCONTINUE\n[ABSTRACT]\nprogress\n[DETAILS]\nfull original details\n[NEXT_ACTION]\ncontinue";
function fixture() {
  const identity = {
    sessionId: "s1",
    parentSessionId: "",
    dialogProcessId: "d1",
    turnScopeId: "t1",
  };
  return [
    {
      ...identity,
      messageUid: "call",
      role: "assistant",
      type: "tool_call",
      content: "thinking",
      tool_calls: [
        { id: "summary", name: "task_summary", args: { summaryContent: body } },
        { id: "read", name: "read_file", args: {} },
      ],
      rawModelContent: [
        { type: "tool_use", id: "summary" },
        { type: "tool_use", id: "read" },
      ],
      modelResponseMetadata: {
        output: [
          { type: "function_call", call_id: "summary" },
          { type: "function_call", call_id: "read" },
        ],
      },
    },
    {
      ...identity,
      messageUid: "summary-result",
      role: "tool",
      type: "tool_result",
      toolName: "task_summary",
      tool_call_id: "summary",
      summarized: false,
      attachments: [{ attachmentId: "a1" }],
      transferEnvelopes: [{ keep: "transfer" }],
      content: JSON.stringify({
        toolName: "task_summary",
        ok: true,
        protocolVersion: 1,
        summary: createTaskSummaryReceipt(body),
      }),
    },
    {
      ...identity,
      messageUid: "read-result",
      role: "tool",
      type: "tool_result",
      toolName: "read_file",
      tool_call_id: "read",
      content: "read",
    },
  ];
}

test("offline migration preserves full body, UID, checkpoint flags and artifacts, removing only the retired call", () => {
  const source = fixture();
  const original = structuredClone(source);
  const result = migrateLegacyPhaseSummaryMessages(source);
  assert.equal(result.changed, true);
  const summary = result.messages[1];
  assert.equal(summary.content, body);
  assert.equal(summary.messageUid, source[1].messageUid);
  assert.equal(summary.summarized, false);
  assert.equal(summary.role, "user");
  assert.equal(summary.type, "message");
  assert.equal(summary.injectedMessageType, CONTEXT_INJECTED_MESSAGE_TYPE.PHASE_SUMMARY_RESULT);
  assert.deepEqual(summary.attachments, source[1].attachments);
  assert.deepEqual(summary.transferEnvelopes, source[1].transferEnvelopes);
  assert.equal(Object.hasOwn(summary, "tool_call_id"), false);
  assert.deepEqual(
    result.messages[0].tool_calls.map((call) => call.id),
    ["read"],
  );
  assert.deepEqual(
    result.messages[0].rawModelContent.map((block) => block.id),
    ["read"],
  );
  assert.deepEqual(
    result.messages[0].modelResponseMetadata.output.map((block) => block.call_id),
    ["read"],
  );
  assert.equal(result.messages[2], source[2]);
  assert.deepEqual(source, original);
  const repeated = migrateLegacyPhaseSummaryMessages(result.messages);
  assert.equal(repeated.changed, false);
  assert.equal(repeated.messages, result.messages);
});

test("offline migration preserves already summarized membership and rejected tool results", () => {
  const source = fixture();
  source[1].summarized = true;
  assert.equal(migrateLegacyPhaseSummaryMessages(source).messages[1].summarized, true);
  source[1].content = JSON.stringify({ ok: false, error: "invalid input" });
  assert.equal(migrateLegacyPhaseSummaryMessages(source).messages, source);
});

const retiredPolicy = { semanticClass: "flow_control", flowControlRole: "checkpoint_boundary" };

for (const sides of [["call", "result"], ["call"]]) {
  test(`offline migration strips the retired policy from rejected pairs on ${sides.join("+")}`, () => {
    const source = fixture();
    source[1].content = JSON.stringify({ ok: false, error: "invalid input" });
    if (sides.includes("call")) source[0].tool_calls[0].contextPolicy = retiredPolicy;
    if (sides.includes("result")) source[1].contextPolicy = retiredPolicy;
    const original = structuredClone(source);
    const result = migrateLegacyPhaseSummaryMessages(source);
    assert.equal(result.changed, true);
    assert.equal(Object.hasOwn(result.messages[0].tool_calls[0], "contextPolicy"), false);
    assert.equal(Object.hasOwn(result.messages[1], "contextPolicy"), false);
    assert.deepEqual(
      result.messages[0].tool_calls.map((call) => call.id),
      ["summary", "read"],
    );
    assert.equal(result.messages[1].content, source[1].content);
    assert.equal(result.messages[1].tool_call_id, "summary");
    assert.deepEqual(source, original);
    const repeated = migrateLegacyPhaseSummaryMessages(result.messages);
    assert.equal(repeated.changed, false);
    assert.equal(repeated.messages, result.messages);
  });
}

for (const mode of ["missing-body", "mismatched-receipt", "duplicate-call", "invalid-json"]) {
  test(`offline migration rejects ${mode} without replacing the source with a receipt`, () => {
    const source = fixture();
    if (mode === "missing-body") source.shift();
    if (mode === "mismatched-receipt")
      source[0].tool_calls[0].args.summaryContent = body.replace(
        "full original details",
        "other details",
      );
    if (mode === "duplicate-call") source[0].tool_calls.push(source[0].tool_calls[0]);
    if (mode === "invalid-json") source[1].content = "broken";
    const previous = structuredClone(source);
    assert.throws(() => migrateLegacyPhaseSummaryMessages(source), {
      code: SESSION_REPAIR_ERROR_CODE.PHASE_SUMMARY_UNMIGRATABLE,
    });
    assert.deepEqual(source, previous);
  });
}

test("phase summary migration failures use the repair data rejection contract", () => {
  assert.ok(
    SESSION_REPAIR_DATA_REJECTION_CODES.includes(
      SESSION_REPAIR_ERROR_CODE.PHASE_SUMMARY_UNMIGRATABLE,
    ),
  );
});

test("offline migration classifies historical harness summaries without changing their full body or coverage", () => {
  const message = {
    ...fixture()[1],
    role: "user",
    type: "message",
    injectedMessage: true,
    injectedBy: "harness-plugin",
    injectedMessageType: "separate_model_relay:summary",
    content:
      "[来自harness外部模型输出/summary]\n[SUMMARY_DETAIL]\noriginal evidence\n[SUMMARY_END]",
  };
  delete message.toolName;
  delete message.tool_call_id;
  const original = structuredClone(message);
  const result = migrateLegacyPhaseSummaryMessages([message]);
  assert.equal(result.changed, true);
  assert.equal(result.messages[0].content, original.content);
  assert.equal(result.messages[0].messageUid, original.messageUid);
  assert.deepEqual(result.messages[0].attachments, original.attachments);
  assert.equal(result.messages[0].summarized, original.summarized);
  assert.equal(
    result.messages[0].injectedMessageType,
    CONTEXT_INJECTED_MESSAGE_TYPE.PHASE_SUMMARY_RESULT,
  );
  assert.equal(migrateLegacyPhaseSummaryMessages(result.messages).changed, false);
  assert.deepEqual(message, original);
});
