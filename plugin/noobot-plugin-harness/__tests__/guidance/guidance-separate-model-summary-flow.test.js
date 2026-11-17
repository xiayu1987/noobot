/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import {
  createTestModelResponse,
  createTestSummaryMessageBlocks,
  createTestHookContext,
  readTestMainFlowControl,
} from "../helpers/public-runtime-fixtures.js";
import test from "node:test";
import assert from "node:assert/strict";
import { createModelRequestExecutor } from "@noobot/model-runtime";
import { ModelProtocolError, normalizeRetryPolicy } from "@noobot/model-protocol";

import {
  createGuidanceHandler,
  createAgentContext,
} from "../helpers/guidance-plan-update-threshold-helper.js";
import { markContextMessageSummarized } from "@noobot/context-protocol/message/codec";

for (const mutation of ["nested-content", "deleted"]) {
  test(`summary rejects ${mutation} changes while saving an attachment before relay or checkpoint`, async () => {
    const handler = createGuidanceHandler({ shouldProcessPrimaryToolHooks: () => true });
    const agentContext = createAgentContext({ pending: { summary: true } });
    const ctx = createTestHookContext({
      agentContext,
      messageBlocks: createTestSummaryMessageBlocks(),
    });
    const incremental = ctx.modelContext.messageBlocks.incremental;
    const target = incremental.at(-1);
    target.content = [{ type: "text", text: "original evidence" }];
    let saved = false;
    agentContext.bindings.runtime.sharedTools = {
      semanticTransfer: {
        async transferSemanticContent() {
          await Promise.resolve();
          saved = true;
          if (mutation === "deleted") incremental.splice(incremental.indexOf(target), 1);
          else target.content[0].text = "changed evidence";
          return { transferEnvelopes: [] };
        },
      },
    };
    await assert.rejects(
      handler({
        capability: "guidance",
        point: "agent.before_llm_call",
        ctx,
        meta: {
          harness: {
            summaryDetailSaveToAttachment: true,
            capabilityModelInvoker: async () => createTestModelResponse("old evidence summary"),
          },
        },
      }),
      /target changed during generation/,
    );
    assert.equal(saved, true);
    const control = readTestMainFlowControl(agentContext);
    assert.equal(control.summaryCheckpoints.length, 0);
    assert.equal(control.phaseSummaries.length, 0);
    assert.equal(agentContext.bindings.extensions.harness.state.pending.summary, true);
    assert.equal(
      ctx.modelContext.messages.some((message) =>
        String(message.content).includes("old evidence summary"),
      ),
      false,
    );
  });
}

test("separate_model summary uses the canonical checkpoint protocol", async () => {
  const handler = createGuidanceHandler({ shouldProcessPrimaryToolHooks: () => true });
  let markedCalled = 0;
  const agentContext = createAgentContext({
    pending: {
      summary: true,
    },
  });
  agentContext.execution = { dialogProcessId: "dp-1" };
  agentContext.bindings.runtime = { systemRuntime: { turnScopeId: "turn-1" } };
  const meta = {
    harness: {
      planningGuidanceMode: "separate_model",
      capabilityModelInvoker: async () => createTestModelResponse("小结完成"),
      markMessagesSummarized: ({ messages = [], summaryScope = {} } = {}) => {
        markedCalled += 1;
        assert.equal(Array.isArray(messages), true);
        assert.equal(messages.length, 2);
        assert.equal(summaryScope?.maxMessages, 2);
        assert.equal(summaryScope?.limitToProvidedMessagesOnly, true);
        for (const item of messages) {
          markContextMessageSummarized(item);
        }
        return messages.length;
      },
    },
  };

  const ctx = {
    messageBlocks: {
      system: [],
      history: [],
      incremental: [
        {
          role: "assistant",
          content: "",
          tool_calls: [{ id: "c1", function: { name: "execute_script" } }],
        },
        {
          role: "tool",
          content: '{"toolName":"execute_script","ok":true}',
          tool_call_id: "c1",
          toolName: "execute_script",
        },
      ],
    },
    agentContext,
  };
  await handler({ capability: "guidance", point: "agent.before_llm_call", ctx, meta });
  assert.equal(markedCalled, 0);
  assert.equal(ctx.modelContext.messageBlocks.incremental[0].summarized, undefined);
  assert.equal(ctx.modelContext.messageBlocks.incremental[1].summarized, undefined);
  assert.deepEqual(
    new Set(readTestMainFlowControl(agentContext).summaryCheckpoints[0].summarizedMessageUids),
    new Set(
      ctx.modelContext.messageBlocks.incremental
        .slice(0, 2)
        .map((message) => message.additional_kwargs.messageUid),
    ),
  );
});

test("failed separate-model summary remains pending until a checkpoint succeeds", async () => {
  const handler = createGuidanceHandler({ shouldProcessPrimaryToolHooks: () => true });
  const agentContext = createAgentContext({ pending: { summary: true } });
  agentContext.execution = { dialogProcessId: "dp-1" };
  agentContext.bindings.runtime = { systemRuntime: { turnScopeId: "turn-1" } };
  const ctx = {
    messageBlocks: {
      system: [],
      history: [],
      incremental: [
        {
          role: "assistant",
          content: "",
          tool_calls: [{ id: "c1", function: { name: "execute_script" } }],
        },
        {
          role: "tool",
          content: '{"ok":true}',
          tool_call_id: "c1",
          toolName: "execute_script",
        },
      ],
    },
    agentContext,
  };
  const meta = {
    harness: {
      planningGuidanceMode: "separate_model",
      capabilityModelInvoker: async () => {
        const error = new Error("capability model timeout (20ms)");
        error.code = "CAPABILITY_MODEL_TIMEOUT";
        throw error;
      },
    },
  };

  await handler({ capability: "guidance", point: "agent.before_llm_call", ctx, meta });

  assert.equal(agentContext.bindings.extensions.harness.state.pending.summary, true);
  assert.ok(
    Array.isArray(
      agentContext.bindings.extensions.harness.state.pending.summaryCheckpointMessageKeys,
    ),
  );
  assert.equal(
    agentContext.bindings.extensions.harness.logs.guidance.some(
      (entry = {}) => entry.event === "guidance_separate_model_call_failed",
    ),
    true,
  );
});

test("separate_model summary request includes previous summary after complete plan checklist", async () => {
  const handler = createGuidanceHandler({ shouldProcessPrimaryToolHooks: () => true });
  let capturedMessages = [];
  const agentContext = createAgentContext({
    planText: "1. 当前完整计划\n1.1 子计划A",
    pending: { summary: true },
  });
  const previousSummary = [
    "[SUMMARY_OVERVIEW]",
    "1. [plan=1][status=done] 上一轮概要",
    "2. [plan=1.1][status=done] 上一轮概要二",
    "3. [plan=1.2][status=warn] 上一轮概要三",
    "[SUMMARY_DETAIL]",
    "- 上一轮详细证据",
    "[SUMMARY_END]",
  ].join("\n");
  const meta = {
    harness: {
      planningGuidanceMode: "separate_model",
      capabilityModelInvoker: async (payload = {}) => {
        if (payload.purpose === "summary") capturedMessages = payload.messages || [];
        return createTestModelResponse("1. [plan=1][status=done] 新小结");
      },
    },
  };

  const ctx = {
    messageBlocks: {
      ...createTestSummaryMessageBlocks(),
      history: [
        {
          role: "user",
          content: previousSummary,
          injectedMessage: true,
          injectedMessageType: "noobot.phase_summary_result",
        },
      ],
    },
    agentContext,
  };
  await handler({ capability: "guidance", point: "agent.before_llm_call", ctx, meta });

  const checklistIndex = capturedMessages.findIndex((item = {}) =>
    String(item?.content || "").startsWith("<!-- harness-plan-checklist-context -->"),
  );
  const previousSummaryIndex = capturedMessages.findIndex((item = {}) =>
    String(item?.content || "").startsWith("<!-- harness-previous-summary-context -->"),
  );
  assert.equal(checklistIndex >= 0, true);
  assert.equal(previousSummaryIndex > checklistIndex, true);
  assert.equal(capturedMessages[checklistIndex]?.role, "user");
  assert.equal(capturedMessages[previousSummaryIndex]?.role, "user");
  assert.equal(previousSummaryIndex, checklistIndex + 1);
  const previousSummaryMessages = capturedMessages.filter((item = {}) =>
    String(item?.content || "").startsWith("<!-- harness-previous-summary-context -->"),
  );
  assert.equal(previousSummaryMessages.length, 1);
  assert.equal(
    String(capturedMessages[previousSummaryIndex]?.content || "").includes("[SUMMARY_DETAIL]"),
    true,
  );
  assert.match(
    String(capturedMessages[previousSummaryIndex]?.content || ""),
    /1\. \[plan=1\]\[status=done\] 上一轮概要/,
  );
  assert.match(
    String(capturedMessages[previousSummaryIndex]?.content || ""),
    /2\. \[plan=1\.1\]\[status=done\] 上一轮概要二/,
  );
  assert.match(
    String(capturedMessages[previousSummaryIndex]?.content || ""),
    /3\. \[plan=1\.2\]\[status=warn\] 上一轮概要三/,
  );
  assert.equal(
    capturedMessages.some(
      (item = {}) =>
        String(item?.content || "").includes("基于上一轮小结") ||
        String(item?.content || "").includes("previous summary"),
    ),
    true,
  );
});

test("separate_model summary request extracts previous summary relay into standalone system message", async () => {
  const handler = createGuidanceHandler({ shouldProcessPrimaryToolHooks: () => true });
  let capturedMessages = [];
  const agentContext = createAgentContext({
    planText: "1. 当前完整计划\n1.1 子计划A",
    pending: { summary: true },
  });
  const previousSummaryRelay = [
    "[来自harness外部模型输出/summary]",
    "[SUMMARY_OVERVIEW]",
    "1. [plan=1][status=done] 上一轮概要",
    "[SUMMARY_DETAIL]",
    "- 仅存在于历史 relay 中的上一轮详细证据",
    "[SUMMARY_END]",
  ].join("\n");
  const meta = {
    harness: {
      planningGuidanceMode: "separate_model",
      capabilityModelInvoker: async (payload = {}) => {
        if (payload.purpose === "summary") capturedMessages = payload.messages || [];
        return createTestModelResponse("1. [plan=1][status=done] 新小结");
      },
    },
  };

  const ctx = {
    messageBlocks: {
      system: [],
      history: [],
      incremental: [
        { role: "user", content: "继续" },
        ...createTestSummaryMessageBlocks().incremental.slice(1),
        {
          role: "user",
          content: previousSummaryRelay,
          injectedMessage: true,
          injectedBy: "harness-plugin",
          injectedMessageType: "noobot.phase_summary_result",
        },
      ],
    },
    agentContext,
  };
  await handler({ capability: "guidance", point: "agent.before_llm_call", ctx, meta });

  const checklistIndex = capturedMessages.findIndex((item = {}) =>
    String(item?.content || "").startsWith("<!-- harness-plan-checklist-context -->"),
  );
  const previousSummaryIndex = capturedMessages.findIndex((item = {}) =>
    String(item?.content || "").startsWith("<!-- harness-previous-summary-context -->"),
  );
  assert.equal(checklistIndex >= 0, true);
  assert.equal(previousSummaryIndex, checklistIndex + 1);
  assert.equal(capturedMessages[previousSummaryIndex]?.role, "user");
  assert.equal(
    String(capturedMessages[previousSummaryIndex]?.content || "").includes("[SUMMARY_DETAIL]"),
    true,
  );
});

test("separate_model summary no longer auto-triggers revision", async () => {
  const handler = createGuidanceHandler({ shouldProcessPrimaryToolHooks: () => true });
  const invocations = [];
  const agentContext = createAgentContext({
    planText: "1. 主任务\n",
    pending: { summary: true },
  });
  const meta = {
    harness: {
      planningGuidanceMode: "separate_model",
      capabilityModelInvoker: async (payload = {}) => {
        invocations.push(payload);
        if (payload.purpose === "summary") return createTestModelResponse("小结完成");
        return createTestModelResponse("");
      },
    },
  };

  await handler({
    capability: "guidance",
    point: "agent.before_llm_call",
    ctx: {
      messageBlocks: createTestSummaryMessageBlocks(),
      agentContext,
    },
    meta,
  });
  assert.deepEqual(
    invocations.map((item = {}) => item.purpose),
    ["summary"],
  );
  assert.equal(agentContext.bindings.extensions.harness.state.counters.planRevisionAttempts, 0);
  assert.equal(agentContext.bindings.extensions.harness.state.counters.planRefinementAttempts, 0);
  assert.equal(
    Object.hasOwn(agentContext.bindings.extensions.harness.state.counters, "planUpdateAttempts"),
    false,
  );
  assert.equal(agentContext.bindings.extensions.harness.state.pending.planRevision, false);
  assert.equal(agentContext.bindings.extensions.harness.state.pending.planRefinement, false);
});

for (const invalidOutput of ["reasoning-only", "whitespace", "tool-call"]) {
  test(`summary ${invalidOutput} transfers once without injecting a summary or requesting a checkpoint`, async () => {
    const handler = createGuidanceHandler({ shouldProcessPrimaryToolHooks: () => true });
    const agentContext = createAgentContext({ pending: { summary: true } });
    const ctx = createTestHookContext({
      agentContext,
      messageBlocks: createTestSummaryMessageBlocks(),
    });
    const initialMessages = [...ctx.modelContext.messages];
    let calls = 0;
    const meta = {
      harness: {
        capabilityModelInvoker: async () => {
          calls += 1;
          return createTestModelResponse(invalidOutput === "tool-call" ? "summary" : " \n ", {
            reasoning: "analysis without a summary",
            toolCalls:
              invalidOutput === "tool-call"
                ? [{ id: "unexpected", name: "execute_script", args: {} }]
                : [],
          });
        },
      },
    };
    const run = () =>
      handler({ capability: "guidance", point: "agent.before_llm_call", ctx, meta });
    await run();
    await run();
    const control = readTestMainFlowControl(agentContext);
    assert.equal(calls, 1);
    assert.equal(control.phaseSummaries.length, 1);
    assert.equal(control.summaryCheckpoints.length, 0);
    assert.deepEqual(ctx.modelContext.messages, initialMessages);
    assert.equal(agentContext.bindings.extensions.harness.state.pending.summary, true);
  });
}

for (const kind of ["temporary_unavailable", "empty_response", "cancelled"]) {
  test(`summary ${kind} follows model retry rules before transferring once to the main flow`, async () => {
    const handler = createGuidanceHandler({ shouldProcessPrimaryToolHooks: () => true });
    const agentContext = createAgentContext({
      planText: "1. 保留计划",
      pending: { summary: true },
    });
    const ctx = createTestHookContext({
      agentContext,
      messageBlocks: {
        ...createTestSummaryMessageBlocks(),
        history: [
          {
            role: "user",
            content: "previous summary evidence",
            injectedMessage: true,
            injectedMessageType: "noobot.phase_summary_result",
          },
        ],
      },
    });
    const cancellation = new DOMException("cancelled", "AbortError");
    let attempts = 0;
    const executor = createModelRequestExecutor({
      registry: {
        resolve: () => ({
          id: "openai-compatible",
          classifyError: (error) => ({ kind: error.name === "AbortError" ? "aborted" : "unknown" }),
          prepareMessages: ({ messages }) => messages,
          invokeChat: ({ client, messages, invokeOptions }) =>
            client.invoke(messages, invokeOptions),
          resolveResponseSource: () => "message",
          createClient: ({ streaming }) => ({
            invoke: async () => {
              attempts += 1;
              assert.equal(streaming, true);
              if (kind === "cancelled") throw cancellation;
              if (kind === "empty_response") return { content: "" };
              throw new ModelProtocolError("unavailable", { kind });
            },
          }),
        }),
      },
      credentialPort: { resolve: () => "test-key" },
      observationPort: { emit() {} },
      clock: { now: () => 0, sleep: async () => {} },
    });
    const meta = {
      harness: {
        planningGuidanceMode: "separate_model",
        capabilityModelInvoker: (payload) => {
          assert.equal(payload.bindTools, false);
          assert.equal(payload.streamingRequired, true);
          return executor.invoke({
            messages: payload.messages,
            metadata: { context: { summaryCheckpointRevision: 0 } },
            options: { streaming: payload.streaming, streamingRequired: payload.streamingRequired },
            model: { model: "summary", operatorId: "test", adapterId: "test" },
            invocation: {
              requestId: "r",
              invocationId: "i",
              sessionId: "s",
              parentSessionId: "",
              dialogProcessId: "d",
              turnScopeId: "t",
              runId: "run",
              flow: "plugin.harness",
              purpose: "summary",
              domain: "guidance",
              contextSequencePolicy: payload.contextSequencePolicy,
            },
          });
        },
      },
    };
    const run = () =>
      handler({ capability: "guidance", point: "agent.before_llm_call", ctx, meta });
    const control = readTestMainFlowControl(agentContext);
    if (kind === "cancelled") {
      await assert.rejects(run(), { name: "AbortError" });
      assert.equal(control.phaseSummaries.length, 0);
      assert.equal(attempts, 1);
      return;
    }
    await run();
    const retry = normalizeRetryPolicy();
    assert.equal(
      attempts,
      kind === "temporary_unavailable"
        ? retry.transport.maxAttempts
        : retry.emptyResponse.maxAttempts + 1,
    );
    assert.equal(control.phaseSummaries.length, 1);
    const instruction = control.phaseSummaries[0];
    assert.match(instruction.prompt, /保留计划/);
    assert.match(instruction.prompt, /previous summary evidence/);
    const previousAttempts = attempts;
    await run();
    assert.equal(attempts, previousAttempts);
    assert.equal(control.phaseSummaries.length, 1);
    assert.equal(agentContext.bindings.extensions.harness.state.pending.summary, true);
    await instruction.onCommitted({ content: "main model summary" });
    assert.equal(agentContext.bindings.extensions.harness.state.pending.summary, false);
    assert.equal(Object.hasOwn(agentContext.bindings.extensions.harness, "summaryFullText"), false);
  });
}
