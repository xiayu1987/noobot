/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import test from "node:test";
import assert from "node:assert/strict";

import { createGuidanceHandler } from "../helpers/context-aware-handler-fixtures.js";
import { attachmentTransfer } from "@noobot/semantic-transfer-protocol";

test("inject-mode summary defaults to injecting full summary to main agent without attachment", async () => {
  const handler = createGuidanceHandler({ shouldProcessPrimaryToolHooks: () => true });
  let ingestCalled = 0;
  const fullSummary = [
    "[SUMMARY_OVERVIEW]",
    "1. [plan=2][status=done] 完成模块分析",
    "",
    "[SUMMARY_DETAIL]",
    "## 详细明细",
    "- 执行了命令A",
    "- 发现风险B",
    "[SUMMARY_END]",
  ].join("\n");
  const ctx = {
    userId: "admin",
    sessionId: "s1",
    messages: [
      { role: "user", content: "继续任务" },
      { role: "assistant", content: "收到" },
    ],
    ai: { content: fullSummary },
    agentContext: {
      execution: {
        controllers: {
          runtime: {
            attachmentService: {
              async ingestGeneratedArtifacts() {
                ingestCalled += 1;
                return [];
              },
            },
          },
        },
      },
      payload: {
        harness: {
          state: {
            flags: { guidanceSummaryMarkPending: true },
            counters: {},
            signals: {},
            pending: {},
          },
          logs: { planning: [], guidance: [], acceptance: [], review: [] },
        },
      },
    },
  };

  await handler({ capability: "guidance", point: "agent.after_llm_call", ctx, meta: {} });

  const harnessBucket = ctx?.agentContext?.payload?.harness || {};
  assert.match(String(harnessBucket.summaryText || ""), /^1\. \[plan=2\]\[status=done\] 完成模块分析/m);
  assert.match(String(harnessBucket.summaryFullText || ""), /\[SUMMARY_DETAIL\]/);
  assert.equal(ingestCalled, 0);
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
    ctx.modelContext.messages.some((item = {}) => String(item?.content || "").includes("DETAIL_PATH:")),
    false,
  );
});

test("inject-mode summary saves detail as a V2 attachment transfer and injects its overview", async () => {
  const handler = createGuidanceHandler({ shouldProcessPrimaryToolHooks: () => true });
  const ctx = {
    userId: "admin",
    sessionId: "s1",
    messages: [
      { role: "user", content: "继续任务" },
      { role: "assistant", content: "收到" },
    ],
    ai: {
      content: [
        "[SUMMARY_OVERVIEW]",
        "1. [plan=2][status=done] 完成模块分析",
        "2. [plan=8][status=todo][risk=高] 文档缺口风险，影响后续交付，建议优先补齐",
        "",
        "[SUMMARY_DETAIL]",
        "## 详细明细",
        "- 执行了命令A",
        "- 发现风险B",
        "[SUMMARY_END]",
      ].join("\n"),
    },
    agentContext: {
      bindings: {
        runtime: {
          sharedTools: {
            semanticTransfer: {
              async transferSemanticContent(payload = {}) {
                return {
                  transferEnvelopes: [attachmentTransfer({
                    transferId: "transfer-summary-detail-1",
                    messageId: "message-summary-detail-1",
                    identity: {
                      sessionId: "s1",
                      turnScopeId: "turn-summary-1",
                      runId: "run-summary-1",
                      producer: payload.producer,
                    },
                    direction: "output",
                    attachments: [{
                      identity: { attachmentId: "att-summary-detail-1", sessionId: "s1", attachmentSource: "model" },
                      role: "primary",
                      name: "summary-detail.md",
                      mimeType: "text/markdown",
                      size: 123,
                    }],
                    intent: { source: "plugin", reason: payload.reason, scenario: payload.scenario, strategy: payload.strategy },
                    meta: { persisted: true },
                  })],
                };
              },
            },
          },
        },
      },
      payload: {
        harness: {
          state: {
            flags: { guidanceSummaryMarkPending: true },
            counters: {},
            signals: {},
            pending: {},
          },
          logs: { planning: [], guidance: [], acceptance: [], review: [] },
        },
      },
    },
  };
  const meta = { harness: { summaryDetailSaveToAttachment: true } };

  await handler({ capability: "guidance", point: "agent.after_llm_call", ctx, meta });

  const harnessBucket = ctx?.agentContext?.payload?.harness || {};
  assert.match(String(harnessBucket.summaryText || ""), /^1\. \[plan=2\]\[status=done\] 完成模块分析/m);
  assert.doesNotMatch(String(harnessBucket.summaryText || ""), /SUMMARY_DETAIL/);

  const injectedDetailMessage = [...ctx.modelContext.messages]
    .reverse()
    .find(
      (item = {}) =>
        String(item?.role || "").trim() === "user" &&
        String(item?.content || "").includes("summary_detail") &&
        String(item?.content || "").includes("完成模块分析"),
    );
  assert.ok(injectedDetailMessage);
  assert.equal(Array.isArray(injectedDetailMessage?.transferEnvelopes), true);
  assert.equal(injectedDetailMessage?.transferEnvelopes?.[0]?.version, 2);
  assert.equal(injectedDetailMessage?.transferEnvelopes?.[0]?.payload?.attachments?.[0]?.identity?.attachmentId, "att-summary-detail-1");
  assert.equal(injectedDetailMessage?.attachments, undefined);

  assert.doesNotMatch(
    ctx.modelContext.messages.map((item = {}) => String(item?.content || "")).join("\n"),
    /summary_pending/,
  );
});
