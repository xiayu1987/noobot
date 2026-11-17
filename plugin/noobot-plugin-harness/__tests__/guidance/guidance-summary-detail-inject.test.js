/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import test from "node:test";
import assert from "node:assert/strict";

import { createGuidanceHandler } from "../helpers/context-aware-handler-fixtures.js";
import {
  attachmentTransfer,
  directTransfer,
  TRANSFER_VERSION,
} from "@noobot/semantic-transfer-protocol";
import { readContextMessageValue } from "@noobot/context-protocol/message/codec";
import {
  createTestModelResponse,
  readTestMainFlowControl,
} from "../helpers/public-runtime-fixtures.js";
import { LENGTH_THRESHOLDS } from "@noobot/shared/length-thresholds";
import { consumeDeferredCapabilityLogs } from "../../src/capabilities/handlers/shared/attachment-log-utils.js";
import { resolveLatestCompleteSummaryText } from "../../src/capabilities/handlers/shared/plan/latest-summary-context.js";

test("independent summary injects full text and clears pending only after checkpoint commit", async () => {
  const handler = createGuidanceHandler({ shouldProcessPrimaryToolHooks: () => true });
  let ingestCalled = 0;
  const fullSummary = [
    "[SUMMARY_OVERVIEW]",
    "1. [plan=2][status=done] 完成模块分析",
    "",
    "[SUMMARY_DETAIL]",
    "## 详细明细",
    "- 执行了命令A",
    "evidence\n".repeat(LENGTH_THRESHOLDS.harness.relayInjectionMaxChars),
    "- 发现风险B",
    "[SUMMARY_END]",
  ].join("\n");
  const ctx = {
    userId: "admin",
    sessionId: "s1",
    messageBlocks: {
      system: [],
      history: [],
      incremental: [
        { role: "user", content: "继续任务" },
        { role: "assistant", content: "", tool_calls: [{ id: "c1", name: "read_file", args: {} }] },
        { role: "tool", content: "source", tool_call_id: "c1" },
      ],
    },
    modelResponse: { text: fullSummary },
    calls: [],
    agentContext: {
      bindings: {
        runtime: {
          attachmentService: {
            async ingestGeneratedArtifacts() {
              ingestCalled += 1;
              return [];
            },
          },
        },
        extensions: {
          harness: {
            state: {
              flags: { planningCaptured: true },
              counters: {},
              signals: {},
              pending: { summary: true },
            },
            logs: { planning: [], guidance: [], acceptance: [], review: [] },
          },
        },
      },
    },
  };

  await handler({
    capability: "guidance",
    point: "agent.before_llm_call",
    ctx,
    meta: {
      harness: {
        capabilityModelInvoker: async (request) => {
          assert.equal(request.streaming, true);
          assert.equal(request.bindTools, false);
          return createTestModelResponse(fullSummary);
        },
      },
    },
  });
  assert.equal(ctx.agentContext.bindings.extensions.harness.state.pending.summary, true);
  const tracedLogs = JSON.stringify(ctx.harnessCapabilityLogs);
  assert.doesNotMatch(tracedLogs, /summary_messages_marked/);
  await readTestMainFlowControl(ctx.agentContext).summaryCheckpoints[0].onCommitted({
    committed: true,
  });

  const nextHook = { agentContext: ctx.agentContext };
  assert.equal(consumeDeferredCapabilityLogs(nextHook), 1);
  assert.equal(nextHook.harnessCapabilityLogs[0].event, "summary_messages_marked");
  assert.equal(JSON.stringify(ctx.harnessCapabilityLogs), tracedLogs);
  assert.equal(consumeDeferredCapabilityLogs({ agentContext: ctx.agentContext }), 0);

  const harnessBucket = ctx?.agentContext?.bindings?.extensions?.harness || {};
  assert.equal(harnessBucket.state.pending.summary, false);
  for (const field of ["summaryText", "summaryFullText", "guidanceOutputs"]) {
    assert.equal(Object.hasOwn(harnessBucket, field), false);
  }
  assert.equal(ingestCalled, 0);
  assert.equal(resolveLatestCompleteSummaryText({ ctx }).includes(fullSummary), true);
  assert.equal(harnessBucket.summaryDetailAttachments, undefined);
  assert.equal(
    ctx.modelContext.messages.some(
      (item = {}) =>
        String(item?.role || "") === "user" &&
        String(item?.content || "").includes("[SUMMARY_DETAIL]") &&
        String(item?.content || "").includes("- 执行了命令A"),
    ),
    true,
  );
  assert.equal(
    ctx.modelContext.messages.some((item = {}) =>
      String(item?.content || "").includes("DETAIL_PATH:"),
    ),
    false,
  );
});

test("independent summary persists and injects the same complete Harness summary", async () => {
  const handler = createGuidanceHandler({ shouldProcessPrimaryToolHooks: () => true });
  let persistedSummaryPayload = null;
  const ctx = {
    userId: "admin",
    sessionId: "s1",
    messageBlocks: {
      system: [],
      history: [],
      incremental: [
        { role: "user", content: "继续任务" },
        { role: "assistant", content: "", tool_calls: [{ id: "c1", name: "read_file", args: {} }] },
        { role: "tool", content: "source", tool_call_id: "c1" },
      ],
    },
    modelResponse: {
      text: [
        "[SUMMARY_OVERVIEW]",
        "1. [plan=2][status=done] 完成模块分析",
        "2. [plan=8][status=todo][risk=高] 文档缺口风险，影响后续交付，建议优先补齐",
        "",
        "[SUMMARY_DETAIL]",
        "## 详细明细",
        "- 执行了命令A",
        "- 发现风险B",
        "[NEXT_EXECUTION_SUGGESTION]",
        "[NEXT_ACTION]",
        "action = do",
        "target = step5",
        "reason = continue from the checkpoint",
        "[SUMMARY_END]",
      ].join("\n"),
    },
    calls: [],
    agentContext: {
      bindings: {
        runtime: {
          sharedTools: {
            semanticTransfer: {
              async transferSemanticContent(payload = {}) {
                if (payload.fullText !== undefined) {
                  return {
                    transferEnvelopes: [
                      directTransfer({
                        transferId: "transfer-summary-text",
                        presentationMessageId: "message-summary-text",
                        identity: {
                          sessionId: "s1",
                          turnScopeId: "turn-summary-1",
                          runId: "run-summary-1",
                          producer: payload.producer,
                        },
                        direction: "output",
                        content: payload.fullText,
                        intent: {
                          source: "plugin",
                          reason: "harness_summary",
                          scenario: "harness",
                          strategy: "harness_summary",
                        },
                      }),
                    ],
                  };
                }
                persistedSummaryPayload = payload;
                return {
                  transferEnvelopes: [
                    attachmentTransfer({
                      transferId: "transfer-summary-detail-1",
                      presentationMessageId: "message-summary-detail-1",
                      identity: {
                        sessionId: "s1",
                        turnScopeId: "turn-summary-1",
                        runId: "run-summary-1",
                        producer: payload.producer,
                      },
                      direction: "output",
                      attachments: [
                        {
                          identity: {
                            attachmentId: "att-summary-detail-1",
                            sessionId: "s1",
                            attachmentSource: "model",
                          },
                          role: "primary",
                          name: "summary-detail.md",
                          mimeType: "text/markdown",
                          size: 123,
                        },
                      ],
                      intent: {
                        source: "plugin",
                        reason: payload.reason,
                        scenario: payload.scenario,
                        strategy: payload.strategy,
                      },
                      meta: { persisted: true },
                    }),
                  ],
                };
              },
            },
          },
        },
        extensions: {
          harness: {
            state: {
              flags: { planningCaptured: true },
              counters: {},
              signals: {},
              pending: { summary: true },
            },
            logs: { planning: [], guidance: [], acceptance: [], review: [] },
          },
        },
      },
    },
  };
  const meta = {
    harness: {
      summaryDetailSaveToAttachment: true,
      capabilityModelInvoker: async () => createTestModelResponse(ctx.modelResponse.text),
    },
  };

  await handler({ capability: "guidance", point: "agent.before_llm_call", ctx, meta });
  await readTestMainFlowControl(ctx.agentContext).summaryCheckpoints[0].onCommitted({
    committed: true,
  });

  const harnessBucket = ctx?.agentContext?.bindings?.extensions?.harness || {};
  assert.equal(harnessBucket.state.pending.summary, false);

  const injectedSummaryMessage = [...ctx.modelContext.messages]
    .reverse()
    .find(
      (item = {}) =>
        String(item?.role || "").trim() === "user" &&
        String(item?.content || "").includes("[SUMMARY_OVERVIEW]") &&
        Array.isArray(readContextMessageValue(item, "transferEnvelopes")),
    );
  assert.ok(injectedSummaryMessage);
  assert.match(String(injectedSummaryMessage?.content || ""), /\[SUMMARY_OVERVIEW\]/);
  assert.match(String(injectedSummaryMessage?.content || ""), /## 详细明细/);
  assert.match(String(injectedSummaryMessage?.content || ""), /- 执行了命令A/);
  assert.match(String(injectedSummaryMessage?.content || ""), /\[NEXT_EXECUTION_SUGGESTION\]/);
  assert.match(String(injectedSummaryMessage?.content || ""), /target = step5/);
  assert.equal(persistedSummaryPayload?.detail, ctx.modelResponse.text);
  assert.equal(
    Array.isArray(readContextMessageValue(injectedSummaryMessage, "transferEnvelopes")),
    true,
  );
  assert.equal(
    readContextMessageValue(injectedSummaryMessage, "transferEnvelopes")?.[0]?.version,
    TRANSFER_VERSION,
  );
  assert.equal(
    readContextMessageValue(injectedSummaryMessage, "transferEnvelopes")?.[0]?.payload
      ?.attachments?.[0]?.identity?.attachmentId,
    "att-summary-detail-1",
  );
  assert.equal(injectedSummaryMessage?.attachments, undefined);

  assert.doesNotMatch(
    ctx.modelContext.messages.map((item = {}) => String(item?.content || "")).join("\n"),
    /summary_pending/,
  );
});
