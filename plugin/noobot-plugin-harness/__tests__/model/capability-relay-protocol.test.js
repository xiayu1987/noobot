/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import test from "node:test";
import assert from "node:assert/strict";

import { resolveModelFinalMessages } from "@noobot/context-protocol";
import { invokeCapabilityModel } from "../../src/capabilities/handlers/shared/model/invocation-utils.js";
import { relaySeparateModelOutputAsUserMessage } from "../../src/capabilities/handlers/shared/relay-model-output.js";
import {
  createTestHookContext,
  createTestModelResponse,
} from "../helpers/public-runtime-fixtures.js";

const RELAY_PURPOSES = Object.freeze([
  "planning",
  "planning_followup",
  "guidance",
  "summary",
  "summary_detail",
  "planning_revision",
  "next_phase_plan",
  "next_phase_plan_followup",
  "planning_refinement",
  "next_phase_plan_refinement",
  "next_phase_plan_refinement_followup",
  "phase_acceptance",
  "acceptance_semantic_validation",
  "acceptance_checklist",
]);

test("all Harness relay purposes cross the canonical capability-to-main-model boundary", async () => {
  for (const purpose of RELAY_PURPOSES) {
    const ctx = createTestHookContext();
    const response = await invokeCapabilityModel({
      invoker: async () => createTestModelResponse(`canonical output for ${purpose}`),
      invokePayload: { purpose, messages: [{ role: "user", content: purpose }] },
      purpose,
      ctx,
    });

    assert.equal(
      relaySeparateModelOutputAsUserMessage(ctx, {
        locale: "en-US",
        purpose,
        content: response.output.text,
      }),
      true,
      purpose,
    );

    const relay = ctx.modelContext.messageBlocks.incremental.at(-1);
    assert.equal(relay.injectedMessage, true, purpose);
    assert.equal(relay.injectedBy, "harness-plugin", purpose);
    assert.equal(relay.injectedMessageType, `separate_model_relay:${purpose}`, purpose);
    assert.match(
      relay.content,
      /auxiliary-capability output, not a tool call or tool result/,
      purpose,
    );
    assert.match(relay.content, new RegExp(`canonical output for ${purpose}$`), purpose);

    const projected = resolveModelFinalMessages({
      systemMessages: ctx.modelContext.messageBlocks.system,
      historyMessages: ctx.modelContext.messageBlocks.history,
      incrementalMessages: ctx.modelContext.messageBlocks.incremental,
    }).messages;
    assert.equal(projected.at(-1), relay, purpose);
  }
});

test("automatic planning refinement relay cannot represent request_plan_refinement tool evidence", () => {
  const ctx = createTestHookContext();
  assert.equal(
    relaySeparateModelOutputAsUserMessage(ctx, {
      locale: "zh-CN",
      purpose: "planning_refinement",
      content: "计划细化结果",
    }),
    true,
  );

  const relay = ctx.modelContext.messageBlocks.incremental.at(-1);
  assert.match(relay.content, /不是任何工具的调用或调用结果/);
  assert.doesNotMatch(relay.content, /request_plan_refinement[^\n]*(已调用|已执行)/);
});
