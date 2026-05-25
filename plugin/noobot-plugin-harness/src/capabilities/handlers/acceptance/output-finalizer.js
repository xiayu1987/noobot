/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import {
  ACCEPTANCE_MODE,
  CAPABILITY_DOMAIN,
  LOCALE,
  appendCapabilityLog,
  attachMetasToLatestInjectedMessage,
  ensureHarnessBucket,
  mapAttachmentRecordsToMetas,
  relaySeparateModelOutputAsUserMessage,
  translateI18nText,
} from "./deps.js";
import { buildAcceptanceReport, renderAcceptanceReportText } from "./report-builder.js";
import { runAcceptanceBySeparateModel } from "./validation-runner.js";

function mergeAttachmentMetasForOutput(existing = [], incoming = []) {
  const current = Array.isArray(existing) ? existing : [];
  const next = Array.isArray(incoming) ? incoming : [];
  if (!next.length) return current;
  const keyOf = (item = {}) =>
    String(item?.attachmentId || "").trim() ||
    `${String(item?.name || "").trim()}|${String(item?.path || "").trim()}`;
  const seen = new Set(current.map((item) => keyOf(item)).filter(Boolean));
  const merged = [...current];
  for (const item of next) {
    const key = keyOf(item);
    if (key && seen.has(key)) continue;
    merged.push(item);
    if (key) seen.add(key);
  }
  return merged;
}

function attachMetasToFinalOutputTurn(ctx = {}, metas = []) {
  if (!Array.isArray(metas) || !metas.length) return false;
  const result = ctx?.result && typeof ctx.result === "object" ? ctx.result : null;
  if (!result) return false;
  const turnMessages = Array.isArray(result.turnMessages) ? result.turnMessages : [];
  for (let index = turnMessages.length - 1; index >= 0; index -= 1) {
    const item = turnMessages[index] || {};
    if (String(item?.role || "").trim() !== "assistant") continue;
    turnMessages[index] = {
      ...item,
      attachmentMetas: mergeAttachmentMetasForOutput(item?.attachmentMetas, metas),
    };
    return true;
  }
  result.attachmentMetas = mergeAttachmentMetasForOutput(result?.attachmentMetas, metas);
  return true;
}

export async function maybeAttachChecklistArtifactsAtFinalOutput(ctx = {}) {
  const holder = ensureHarnessBucket(ctx);
  if (!holder) return false;
  const { bucket, state } = holder;
  if (state.flags.checklistArtifactsAttached === true) return false;

  const runtime = ctx?.agentContext?.execution?.controllers?.runtime || null;
  const attachmentService = runtime?.attachmentService || null;
  if (!attachmentService || typeof attachmentService.ingestGeneratedArtifacts !== "function") {
    return false;
  }
  const userId = String(
    ctx?.userId || runtime?.systemRuntime?.userId || runtime?.userId || "",
  ).trim();
  const sessionId = String(
    ctx?.sessionId || runtime?.systemRuntime?.sessionId || runtime?.sessionId || "",
  ).trim();
  if (!userId || !sessionId) return false;

  const locale = state?.locale || LOCALE.ZH_CN;
  const acceptanceReport =
    bucket?.lastAcceptanceReport && typeof bucket.lastAcceptanceReport === "object"
      ? bucket.lastAcceptanceReport
      : buildAcceptanceReport({ bucket, state, mode: ACCEPTANCE_MODE.FORCED });

  const artifacts = [
    {
      name: "harness-plan-text.txt",
      mimeType: "text/plain",
      contentBase64: Buffer.from(
        [
          `[generatedAt] ${new Date().toISOString()}`,
          "[planText]",
          String(bucket?.planText || "").trim(),
        ].filter(Boolean).join("\n"),
        "utf8",
      ).toString("base64"),
    },
    {
      name: "harness-acceptance-report.txt",
      mimeType: "text/plain",
      contentBase64: Buffer.from(
        [
          `[generatedAt] ${new Date().toISOString()}`,
          renderAcceptanceReportText(acceptanceReport, locale),
        ].filter(Boolean).join("\n\n"),
        "utf8",
      ).toString("base64"),
    },
  ];

  let savedRecords = [];
  try {
    savedRecords = await attachmentService.ingestGeneratedArtifacts({
      userId,
      sessionId,
      attachmentSource: "model",
      generationSource: "harness_checklist",
      artifacts,
    });
  } catch (error) {
    appendCapabilityLog(ctx, {
      domain: CAPABILITY_DOMAIN.ACCEPTANCE,
      event: "checklist_artifact_attach_failed",
      detail: { error: String(error?.message || error || "") },
    });
    return false;
  }

  const metas = mapAttachmentRecordsToMetas(savedRecords);
  if (!metas.length) return false;
  const attachedToInjectedMessage = attachMetasToLatestInjectedMessage(ctx, metas);
  const attachedToFinalOutput = attachMetasToFinalOutputTurn(ctx, metas);
  if (!attachedToInjectedMessage && !attachedToFinalOutput) {
    relaySeparateModelOutputAsUserMessage(ctx, {
      locale,
      purpose: "acceptance_checklist",
      content:
        locale === LOCALE.EN_US
          ? "Harness checklist artifacts generated. See attachmentMetas for details."
          : "已生成 harness 清单附件，详见 attachmentMetas。",
      dedupe: true,
      attachmentMetas: metas,
    });
  }
  state.flags.checklistArtifactsAttached = true;
  appendCapabilityLog(ctx, {
    domain: CAPABILITY_DOMAIN.ACCEPTANCE,
    event: "checklist_artifacts_attached",
    detail: { attachmentCount: metas.length },
  });
  return true;
}

export async function maybeForceAcceptanceAtFinalOutput(ctx = {}, meta = {}) {
  const holder = ensureHarnessBucket(ctx);
  if (!holder) return false;
  const { bucket, state } = holder;
  if (state.flags.acceptanceRequested === true) return false;
  const report = buildAcceptanceReport({ bucket, state, mode: ACCEPTANCE_MODE.FORCED });
  bucket.lastAcceptanceReport = report;
  bucket.acceptanceReports.push(report);
  if (ctx?.result && typeof ctx.result === "object") {
    await runAcceptanceBySeparateModel(ctx, meta, report);
    const locale = state?.locale || LOCALE.ZH_CN;
    const original = String(ctx.result.output || "").trim();
    ctx.result.output = [
      original,
      "",
      translateI18nText(locale, "forcedAcceptanceHeader"),
      renderAcceptanceReportText(report, locale),
    ].filter(Boolean).join("\n");
    appendCapabilityLog(ctx, {
      domain: CAPABILITY_DOMAIN.ACCEPTANCE,
      event: "forced_acceptance_triggered",
    });
    return true;
  }
  return false;
}
