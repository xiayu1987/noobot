/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { expect, it } from "vitest";
import { assertCanonicalToolPairs } from "../../e2e/protocol/helpers/thinking-tool-assertions.js";
import { assertCapabilityModelTraces } from "../../e2e/protocol/helpers/harness-assertions.js";

function tool(event, id, overrides = {}) {
  return {
    event,
    data: { tool: "read", toolCallId: id, success: true, result: "ok", ...overrides },
  };
}

it("pairs results by identity without assuming completion order", () => {
  const events = [
    tool("tool_call_start", "a"),
    tool("tool_call_start", "b"),
    tool("tool_call_end", "b"),
    tool("tool_call_end", "a"),
  ];
  expect(assertCanonicalToolPairs(events, ["read", "read"]).results).toHaveLength(2);
  for (const changes of [
    [tool("tool_call_end", "a"), tool("tool_call_end", "a")],
    [tool("tool_call_end", "a"), tool("tool_call_end", "c")],
    [tool("tool_call_end", "a"), tool("tool_call_end", "b", { success: false })],
    [tool("tool_call_end", "a"), tool("tool_call_end", "b", { result: "" })],
    [tool("tool_call_end", "a"), tool("tool_call_end", "b", { tool: "write" })],
  ])
    expect(() =>
      assertCanonicalToolPairs([...events.slice(0, 2), ...changes], ["read", "read"]),
    ).toThrow();
  expect(() =>
    assertCanonicalToolPairs([events[0], events[0], ...events.slice(2)], ["read", "read"]),
  ).toThrow();
});

it("keeps capability evidence validation strict for all attempt outcomes", () => {
  const trace = {
    event: "capability_model_trace",
    eventId: "event",
    traceId: "trace",
    domain: "planning",
    detail: {
      purpose: "planning",
      modelAttempts: [
        {
          attempt: 1,
          status: "completed",
          kind: "chat",
          streaming: false,
          output: { toolCalls: [], finishReason: "stop" },
        },
      ],
    },
  };
  expect(() => assertCapabilityModelTraces([trace])).not.toThrow();
  expect(() => assertCapabilityModelTraces([trace, trace])).toThrow();
  for (const overrides of [
    { attempt: 0 },
    { status: "unknown" },
    { streaming: undefined },
    { output: undefined },
    { output: { toolCalls: "bad", finishReason: "stop" } },
    { status: "failed", output: undefined },
  ]) {
    const invalid = structuredClone(trace);
    Object.assign(invalid.detail.modelAttempts[0], overrides);
    expect(() => assertCapabilityModelTraces([invalid])).toThrow();
  }
  const failed = structuredClone(trace);
  failed.detail.modelAttempts[0] = {
    attempt: 1,
    status: "failed",
    kind: "chat",
    streaming: true,
    error: "provider failure",
  };
  expect(() => assertCapabilityModelTraces([failed])).not.toThrow();
});
