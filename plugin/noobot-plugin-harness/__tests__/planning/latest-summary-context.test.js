/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import test from "node:test";
import assert from "node:assert/strict";
import { CONTEXT_INJECTED_MESSAGE_TYPE } from "@noobot/context-protocol/message/injected-types";
import { resolveLatestCompleteSummaryText } from "../../src/capabilities/handlers/shared/plan/latest-summary-context.js";
import { createTestHookContext } from "../helpers/public-runtime-fixtures.js";

const summary = (content) => ({
  role: "user",
  content,
  injectedMessage: true,
  injectedMessageType: CONTEXT_INJECTED_MESSAGE_TYPE.PHASE_SUMMARY_RESULT,
});
function context(history, incremental) {
  return createTestHookContext({}, { messageBlocks: { system: [], history, incremental } });
}

test("latest summary body comes from classified messages across sources and turns", () => {
  const content =
    "[SUMMARY_OVERVIEW]\n1. current\n[SUMMARY_DETAIL]\ncomplete evidence\n[SUMMARY_END]";
  const ctx = context(
    [summary("old main summary")],
    [
      summary(`[Relay from harness external model/summary]\n${content}`),
      { role: "user", content: "[来自harness外部模型输出/summary]\nnot a summary category" },
    ],
  );
  assert.equal(resolveLatestCompleteSummaryText({ ctx }), content);
  assert.equal(resolveLatestCompleteSummaryText({ ctx: context([summary(content)], []) }), content);
});

test("latest main summary supersedes a harness summary without a plugin bucket copy", () => {
  const ctx = context(
    [summary("[来自harness外部模型输出/summary]\nold harness summary")],
    [summary("current main summary")],
  );
  assert.equal(resolveLatestCompleteSummaryText({ ctx }), "current main summary");
});

test("summary text blocks use the canonical message content reader", () => {
  const ctx = context(
    [summary("old summary")],
    [
      summary([
        { type: "text", text: "[Relay from harness external model/summary]" },
        { type: "text", text: "current evidence" },
        { type: "text", text: "next action" },
      ]),
    ],
  );
  assert.equal(resolveLatestCompleteSummaryText({ ctx }), "current evidence\nnext action");
});

test("summary text is never inferred from prefixes or retired bucket fields", () => {
  const bucket = {
    summaryText: "retired overview",
    summaryFullText: "retired body",
    guidanceOutputs: [{ purpose: "summary", content: "retired output" }],
  };
  const ctx = context(
    [],
    [{ role: "user", content: "[来自harness外部模型输出/summary]\nunclassified" }],
  );
  assert.equal(resolveLatestCompleteSummaryText({ ctx, bucket }), "");
});
