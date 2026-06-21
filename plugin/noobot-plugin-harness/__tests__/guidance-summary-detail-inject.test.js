/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import test from "node:test";
import assert from "node:assert/strict";

import { createGuidanceHandler } from "../src/capabilities/handlers/guidance.js";

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

  await handler({ capability: "guidance", point: "after_llm_call", ctx, meta: {} });

  const harnessBucket = ctx?.agentContext?.payload?.harness || {};
  assert.match(String(harnessBucket.summaryText || ""), /^1\. \[plan=2\]\[status=done\] 完成模块分析/m);
  assert.match(String(harnessBucket.summaryFullText || ""), /\[SUMMARY_DETAIL\]/);
  assert.equal(ingestCalled, 0);
  assert.equal(Array.isArray(harnessBucket.summaryDetailAttachmentMetas), true);
  assert.equal(harnessBucket.summaryDetailAttachmentMetas.length, 0);
  assert.equal(
    ctx.messages.some(
      (item = {}) =>
        String(item?.role || "") === "user" &&
        String(item?.content || "").includes("[SUMMARY_DETAIL]") &&
        String(item?.content || "").includes("- 执行了命令A"),
    ),
    true,
  );
  assert.equal(
    ctx.messages.some((item = {}) => String(item?.content || "").includes("DETAIL_PATH:")),
    false,
  );
});

test("inject-mode summary can save detail as attachment and inject detail path to main agent", async () => {
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
      execution: {
        controllers: {
          runtime: {
            systemRuntime: { userId: "admin", sessionId: "s1" },
            sharedTools: {
              semanticTransfer: {
                async persistTransferFile() {
                  const attachmentMeta = {
                    attachmentId: "att-summary-detail-1",
                    sessionId: "s1",
                    attachmentSource: "model",
                    name: "summary-detail.md",
                    mimeType: "text/markdown",
                    size: 123,
                    path: "/workspace/admin/runtime/summary-detail.md",
                    relativePath: "runtime/summary-detail.md",
                    generatedByModel: true,
                    generationSource: "harness_summary_detail",
                  };
                  const envelope = {
                    protocol: "noobot.semantic-transfer",
                    version: 1,
                    direction: "output",
                    transport: "file",
                    filePath: "/sandbox/admin/runtime/summary-detail.md",
                    attachmentMeta,
                    files: [{ filePath: "/sandbox/admin/runtime/summary-detail.md", attachmentMeta, role: "primary" }],
                  };
                  return {
                    transferResult: { ok: true, status: "file", envelope },
                    envelope,
                    transferEnvelopes: [envelope],
                  };
                },
              },
              resolveAttachmentDisplayPath({ meta = {} } = {}) {
                return String(meta?.path || "").replace("/workspace/admin", "/injected/admin");
              },
              resolveSandboxPath({ hostPath = "" } = {}) {
                const normalized = String(hostPath || "").trim();
                if (!normalized) return "";
                return normalized.replace("/workspace/admin", "/sandbox/admin");
              },
            },
            attachmentService: {
              async ingestGeneratedArtifacts() {
                return [
                  {
                    attachmentId: "att-summary-detail-1",
                    sessionId: "s1",
                    attachmentSource: "model",
                    name: "summary-detail.md",
                    mimeType: "text/markdown",
                    size: 123,
                    path: "/workspace/admin/runtime/summary-detail.md",
                    relativePath: "runtime/summary-detail.md",
                    generatedByModel: true,
                    generationSource: "harness_summary_detail",
                  },
                ];
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

  await handler({ capability: "guidance", point: "after_llm_call", ctx, meta });

  const harnessBucket = ctx?.agentContext?.payload?.harness || {};
  assert.match(String(harnessBucket.summaryText || ""), /^1\. \[plan=2\]\[status=done\] 完成模块分析/m);
  assert.doesNotMatch(String(harnessBucket.summaryText || ""), /SUMMARY_DETAIL/);

  const injectedDetailPathMessage = [...ctx.messages]
    .reverse()
    .find(
      (item = {}) =>
        String(item?.role || "").trim() === "user" &&
        String(item?.content || "").includes("summary_detail_path") &&
        String(item?.content || "").includes("DETAIL_PATH: /injected/admin/runtime/summary-detail.md") &&
        String(item?.content || "").includes("/injected/admin/runtime/summary-detail.md"),
    );
  assert.ok(injectedDetailPathMessage);
  assert.equal(Array.isArray(injectedDetailPathMessage?.transferEnvelopes), true);
  assert.equal(injectedDetailPathMessage?.transferEnvelopes?.[0]?.protocol, "noobot.semantic-transfer");
  assert.equal(injectedDetailPathMessage.transferEnvelopes.length, 1);
  assert.equal(injectedDetailPathMessage?.transferResult?.ok, true);

  assert.doesNotMatch(
    ctx.messages.map((item = {}) => String(item?.content || "")).join("\n"),
    /summary_pending/,
  );
});
