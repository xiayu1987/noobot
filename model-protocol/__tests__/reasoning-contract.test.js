/* Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import test from "node:test";
import assert from "node:assert/strict";
import {
  buildModelReasoningEffortTransport,
  listModelLibraryOptions,
  normalizeModelReasoningConfiguration,
  resolveModelLibraryProvider,
  resolveModelMinimumReasoningEffort,
} from "../src/index.js";

test("reasoning transport is declared by the provider, never inferred from a model name", () => {
  const misleading = {
    model: "gemini-3.7-flash",
    reasoning_effort_parameter: "reasoning_effort",
    reasoning_effort_options: ["low", "high"],
    reasoning_effort: "high",
  };
  assert.deepEqual(buildModelReasoningEffortTransport(misleading, "high"), {
    reasoning_effort: "high",
  });
  const declared = {
    model: "in-house-model",
    reasoning_effort_parameter: "thinking_level",
    reasoning_effort_options: ["low", "medium"],
  };
  assert.deepEqual(buildModelReasoningEffortTransport(declared, "medium"), {
    thinking_level: "medium",
  });
});

test("a switch-shaped reasoning parameter carries a boolean on the wire", () => {
  const provider = {
    reasoning_effort_parameter: "enable_thinking",
    reasoning_effort_options: ["none", "medium"],
  };
  assert.deepEqual(buildModelReasoningEffortTransport(provider, "medium"), {
    enable_thinking: true,
  });
  assert.deepEqual(buildModelReasoningEffortTransport(provider, "none"), {
    enable_thinking: false,
  });
});

test("reasoning declarations support an open option set without silently defaulting", () => {
  assert.deepEqual(
    normalizeModelReasoningConfiguration({
      reasoning_effort_parameter: "reasoning_effort",
      reasoning_effort: " Custom-Level ",
      tool_reasoning_effort: "Tool-Level",
    }),
    {
      reasoning_effort_parameter: "reasoning_effort",
      reasoning_effort_options: [],
      reasoning_effort: "Custom-Level",
      tool_reasoning_effort: "Tool-Level",
    },
  );
  assert.deepEqual(
    buildModelReasoningEffortTransport(
      { reasoning_effort_parameter: "reasoning_effort" },
      "Custom-Level",
    ),
    { reasoning_effort: "Custom-Level" },
  );
  assert.throws(
    () => normalizeModelReasoningConfiguration({ reasoning_effort_options: ["low"] }),
    /reasoning_effort_parameter/,
  );
  assert.throws(
    () =>
      normalizeModelReasoningConfiguration({
        reasoning_effort_options: ["low"],
        reasoning_effort_parameter: "thinking_budget",
      }),
    /unsupported model provider reasoning_effort_parameter/,
  );
});

test("an effort outside the declared options resolves to the lowest declared level", () => {
  const normalized = normalizeModelReasoningConfiguration({
    reasoning_effort_parameter: "reasoning_effort",
    reasoning_effort_options: ["high", "max"],
    reasoning_effort: "medium",
    tool_reasoning_effort: "invalid",
  });
  assert.equal(normalized.reasoning_effort, "high");
  assert.equal(normalized.tool_reasoning_effort, "high");
  assert.equal(resolveModelMinimumReasoningEffort(normalized), "high");
});

test("every library provider declares a canonical reasoning contract", () => {
  for (const option of listModelLibraryOptions()) {
    const provider = resolveModelLibraryProvider(option.key);
    assert.deepEqual(
      normalizeModelReasoningConfiguration(provider),
      {
        reasoning_effort_parameter: provider.reasoning_effort_parameter,
        reasoning_effort_options: provider.reasoning_effort_options,
        reasoning_effort: provider.reasoning_effort,
        tool_reasoning_effort: provider.tool_reasoning_effort,
      },
      `${option.key} declares a non-canonical reasoning contract`,
    );
  }
});
