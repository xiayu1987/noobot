/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import test from "node:test";
import assert from "node:assert/strict";
import { decideTransfer, previewTransferText } from "@noobot/semantic-transfer-protocol";
import {
  materializeTextForToolResult,
  resolveToolResultInlineTextLimit,
} from "../../src/transfer-adapter/transfer/tool-result-text.js";
import { identity } from "./helpers/semantic-transfer-helper.js";

test("direct text uses its envelope as the sole delivery fact", async () => {
  const result = await materializeTextForToolResult({ text: "plain", identity: identity() });
  assert.equal(result.resultFields.text, "plain");
  assert.equal(result.transferEnvelopes[0].payload.mode, "direct");
  assert.equal(Object.hasOwn(result.resultFields, "contentStoredInFile"), false);
});

test("text preview preserves astral characters and measures the retained preview", async () => {
  const result = await materializeTextForToolResult({
    text: "a😀b",
    identity: identity(),
    forcePreview: true,
    previewChars: 2,
  });
  assert.equal(result.resultFields.textPreview, "a");
  assert.equal(result.resultFields.textPreviewLength, 1);
  assert.equal(result.resultFields.textPreviewTruncated, true);
  assert.equal(previewTransferText("a😀b", 3), "a😀");
  assert.equal(previewTransferText("中文", 1), "中");
  assert.equal(previewTransferText("😀", 0), "");
});

test("transfer budgets reject invalid values and honor zero without clamping", () => {
  for (const value of [null, "12", -1, 1.5, NaN, Infinity]) {
    assert.throws(
      () =>
        resolveToolResultInlineTextLimit({ userConfig: { tools: { maxToolResultChars: value } } }),
      /invalid_transfer_char_limit/,
    );
    assert.throws(
      () => decideTransfer({ content: "x", policy: { maxDirectChars: value } }),
      /invalid_transfer_char_limit/,
    );
  }
  assert.equal(
    resolveToolResultInlineTextLimit({ userConfig: { tools: { maxToolResultChars: 12 } } }),
    12,
  );
  assert.equal(decideTransfer({ content: "x", policy: { maxDirectChars: 0 } }).mode, "attachment");
});
