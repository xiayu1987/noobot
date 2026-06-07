/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import test from "node:test";
import assert from "node:assert/strict";

import { createGuidanceHandler } from "../src/capabilities/handlers/guidance.js";

test("inject-mode summary saves detail as attachment and injects detail path to main agent", async () => {
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
                    attachmentMetas: [attachmentMeta],
                    transferResult: { ok: true, status: "file", envelope },
                    envelope,
                    transferEnvelope: envelope,
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
  const meta = {};

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
  assert.equal(Array.isArray(injectedDetailPathMessage?.attachmentMetas), true);
  assert.equal(injectedDetailPathMessage.attachmentMetas.length, 1);
  assert.equal(injectedDetailPathMessage?.transferEnvelope?.protocol, "noobot.semantic-transfer");
  assert.equal(Array.isArray(injectedDetailPathMessage?.transferEnvelopes), true);
  assert.equal(injectedDetailPathMessage.transferEnvelopes.length, 1);
  assert.equal(injectedDetailPathMessage?.transferResult?.ok, true);

  assert.doesNotMatch(
    ctx.messages.map((item = {}) => String(item?.content || "")).join("\n"),
    /summary_pending/,
  );
});
