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

test("inject-mode summary persists and injects the same complete Harness summary", async () => {
  const handler = createGuidanceHandler({ shouldProcessPrimaryToolHooks: () => true });
  let persistedSummaryPayload = null;
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
        "[NEXT_EXECUTION_SUGGESTION]",
        "[NEXT_ACTION]",
        "action = do",
        "target = step5",
        "reason = continue from the checkpoint",
        "[SUMMARY_END]",
      ].join("\n"),
    },
    agentContext: {
      bindings: {
        runtime: {
          sharedTools: {
            semanticTransfer: {
              async transferSemanticContent(payload = {}) {
                persistedSummaryPayload = payload;
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

  const injectedSummaryMessage = [...ctx.modelContext.messages]
    .reverse()
    .find(
      (item = {}) =>
        String(item?.role || "").trim() === "user" &&
        String(item?.content || "").includes("[SUMMARY_OVERVIEW]") &&
        Array.isArray(item?.transferEnvelopes),
    );
  assert.ok(injectedSummaryMessage);
  assert.match(String(injectedSummaryMessage?.content || ""), /\[SUMMARY_OVERVIEW\]/);
  assert.match(String(injectedSummaryMessage?.content || ""), /## 详细明细/);
  assert.match(String(injectedSummaryMessage?.content || ""), /- 执行了命令A/);
  assert.match(String(injectedSummaryMessage?.content || ""), /\[NEXT_EXECUTION_SUGGESTION\]/);
  assert.match(String(injectedSummaryMessage?.content || ""), /target = step5/);
  assert.equal(persistedSummaryPayload?.detail, ctx.ai.content);
  assert.equal(Array.isArray(injectedSummaryMessage?.transferEnvelopes), true);
  assert.equal(injectedSummaryMessage?.transferEnvelopes?.[0]?.version, 2);
  assert.equal(injectedSummaryMessage?.transferEnvelopes?.[0]?.payload?.attachments?.[0]?.identity?.attachmentId, "att-summary-detail-1");
  assert.equal(injectedSummaryMessage?.attachments, undefined);

  assert.doesNotMatch(
    ctx.modelContext.messages.map((item = {}) => String(item?.content || "")).join("\n"),
    /summary_pending/,
  );
});
