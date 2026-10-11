/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import test from "node:test";
import assert from "node:assert/strict";

import { adaptToolsForBinding } from "../../../src/models/tool/binding-adapter.js";

const GPT_SPEC = Object.freeze({ model: "gpt-5.5" });

test("adaptToolsForBinding requires a resolved model spec", () => {
  assert.throws(() => adaptToolsForBinding([{ name: "read_file" }]), /resolved model spec/);
  assert.throws(() => adaptToolsForBinding([{ name: "read_file" }], {}), /resolved model spec/);
});

test("adaptToolsForBinding drops invalid names and deduplicates", () => {
  const adapted = adaptToolsForBinding(
    [{ name: "valid_tool" }, { name: "invalid tool" }, { name: "valid_tool" }, { name: "" }],
    GPT_SPEC,
  );

  assert.deepEqual(
    adapted.tools.map((toolItem) => toolItem.name),
    ["valid_tool"],
  );
  assert.deepEqual(adapted.droppedToolNames, ["invalid tool", "(empty)"]);
});

test("adaptToolsForBinding returns tools in stable name order", () => {
  const adapted = adaptToolsForBinding(
    [{ name: "write_file" }, { name: "read_file" }, { name: "execute_script" }],
    GPT_SPEC,
  );

  assert.deepEqual(
    adapted.tools.map((toolItem) => toolItem.name),
    ["execute_script", "read_file", "write_file"],
  );
});

test("adaptToolsForBinding always sends an explicit boolean strict", () => {
  assert.deepEqual(adaptToolsForBinding([{ name: "task_summary" }], GPT_SPEC).bindOptions, {
    tool_choice: "auto",
    strict: false,
  });
  assert.deepEqual(
    adaptToolsForBinding([{ name: "task_summary" }], { model: "gpt-5.3-codex" }).bindOptions,
    { tool_choice: "auto", strict: false },
  );
});

test("adaptToolsForBinding reads strict only from the declared spec field", () => {
  const adapted = adaptToolsForBinding([{ name: "task_summary" }], {
    model: "gpt-4o-mini",
    strict_tool_schema: true,
  });

  assert.deepEqual(adapted.bindOptions, { tool_choice: "auto", strict: true });
});

test("adaptToolsForBinding downgrades strict when call_service is present", () => {
  const adapted = adaptToolsForBinding([{ name: "call_service" }], {
    model: "gpt-5.5",
    strict_tool_schema: true,
  });

  assert.deepEqual(adapted.bindOptions, { tool_choice: "auto", strict: false });
  assert.deepEqual(adapted.strictDowngradedTools, ["call_service"]);
});

test("adaptToolsForBinding omits bind options without tools", () => {
  assert.deepEqual(adaptToolsForBinding([], GPT_SPEC).bindOptions, {});
});

test("adaptToolsForBinding keeps tools for Bedrock-hosted Claude models", () => {
  const adapted = adaptToolsForBinding([{ name: "read_file" }], {
    provider: "aws_bedrock",
    base_url: "https://bedrock-runtime.us-east-1.amazonaws.com/openai/v1",
    model: "anthropic.claude-3-5-sonnet-20241022-v2:0",
  });

  assert.deepEqual(adapted.bindOptions, { tool_choice: "auto", strict: false });
  assert.deepEqual(
    adapted.tools.map((toolItem) => toolItem.name),
    ["read_file"],
  );
});

test("adaptToolsForBinding drops tool_search definitions for Claude models", () => {
  const adapted = adaptToolsForBinding(
    [
      { name: "read_file", defer_loading: true },
      { name: "write_file", deferLoading: true },
      { name: "tool_search" },
      { name: "tool_search_regex", type: "tool_search_tool_regex_20251119" },
      { name: "tool_search_bm25", type: "tool_search_tool_bm25_20251119" },
    ],
    { model: "claude-opus-4-8" },
  );

  assert.deepEqual(
    adapted.tools.map((toolItem) => toolItem.name),
    ["read_file", "write_file"],
  );
  assert.equal("defer_loading" in adapted.tools[0], false);
  assert.equal("deferLoading" in adapted.tools[1], false);
  assert.deepEqual(adapted.droppedToolNames, [
    "tool_search",
    "tool_search_regex",
    "tool_search_bm25",
  ]);
});

test("adaptToolsForBinding keeps tool_search definitions for non-Claude models", () => {
  const adapted = adaptToolsForBinding(
    [
      {
        name: "tool_search_regex",
        type: "tool_search_tool_regex_20251119",
        defer_loading: true,
      },
    ],
    GPT_SPEC,
  );

  assert.deepEqual(
    adapted.tools.map((toolItem) => toolItem.name),
    ["tool_search_regex"],
  );
  assert.deepEqual(adapted.droppedToolNames, []);
  assert.equal(adapted.tools[0].defer_loading, true);
});
