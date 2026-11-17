/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import test from "node:test";
import assert from "node:assert/strict";
import { runGuidanceBySeparateModel } from "../../src/capabilities/handlers/guidance/model-runner.js";
import {
  createTestHookContext,
  readTestMainFlowControl,
} from "../helpers/public-runtime-fixtures.js";
import { createAgentContext } from "../helpers/guidance-plan-update-threshold-helper.js";
import { CONTEXT_INJECTED_MESSAGE_TYPE } from "@noobot/context-protocol/message/injected-types";

for (const [name, incremental] of [
  ["empty context", []],
  ["retained user", [{ role: "user", content: "continue" }]],
  [
    "retained summary",
    [
      {
        role: "user",
        content: "summary",
        injectedMessage: true,
        injectedMessageType: CONTEXT_INJECTED_MESSAGE_TYPE.PHASE_SUMMARY_RESULT,
      },
    ],
  ],
  [
    "incomplete tools",
    [
      {
        role: "assistant",
        content: "",
        tool_calls: [{ id: "call", function: { name: "read_file" } }],
      },
    ],
  ],
]) {
  test(`direct summary clears pending without invoking a model for ${name}`, async () => {
    const agentContext = createAgentContext({ pending: { summary: true } });
    const ctx = createTestHookContext({
      agentContext,
      messageBlocks: { system: [], history: [], incremental },
    });
    let calls = 0;
    await runGuidanceBySeparateModel(
      ctx,
      {
        harness: {
          capabilityModelInvoker: async () => {
            calls++;
            throw new Error("unexpected invocation");
          },
        },
      },
      { action: "summary" },
    );
    assert.equal(calls, 0);
    assert.equal(agentContext.bindings.extensions.harness.state.pending.summary, false);
  });
}

for (const command of ["phaseSummary", "checkpoint"]) {
  test(`direct summary preserves pending while ${command} is in flight`, async () => {
    const agentContext = createAgentContext({ pending: { summary: true } });
    const ctx = createTestHookContext({
      agentContext,
      messageBlocks: { system: [], history: [], incremental: [] },
    });
    const port = agentContext.bindings.mainFlowControl;
    if (command === "phaseSummary")
      port.requestPhaseSummary({
        source: "plugin.summary",
        prompt: "summarize",
        onCommitted: () => {},
      });
    else
      port.requestSummaryCheckpoint({ source: "plugin.summary", summarizedMessageUids: ["work"] });
    await runGuidanceBySeparateModel(ctx, {}, { action: "summary" });
    assert.equal(agentContext.bindings.extensions.harness.state.pending.summary, true);
    assert.ok(readTestMainFlowControl(agentContext));
  });
}
