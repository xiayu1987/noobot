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
  attachArtifactsToAssistantResult,
  defaultTaskChecklist,
  ensureHarnessBucket,
  getDefaultTaskOwner,
  mapAttachmentRecordsToMetas,
  mergeAttachmentMetas,
  translateI18nText,
} from "./deps.js";
import { buildAcceptanceReport } from "./report-builder.js";
import { runAcceptanceBySeparateModel } from "./validation-runner.js";

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
  const checklist = Array.isArray(bucket?.taskChecklist) && bucket.taskChecklist.length
    ? bucket.taskChecklist
    : defaultTaskChecklist(locale);
  const acceptanceReport =
    bucket?.lastAcceptanceReport && typeof bucket.lastAcceptanceReport === "object"
      ? bucket.lastAcceptanceReport
      : buildAcceptanceReport({ bucket, state, mode: ACCEPTANCE_MODE.FORCED });

  const artifacts = [
    {
      name: "harness-task-checklist.json",
      mimeType: "application/json",
      contentBase64: Buffer.from(
        JSON.stringify(
          {
            generatedAt: new Date().toISOString(),
            totalGoal: bucket?.totalGoal || "",
            taskOwner: bucket?.taskOwner || getDefaultTaskOwner(locale),
            nextPhase: bucket?.nextPhase || null,
            taskChecklist: checklist,
          },
          null,
          2,
        ),
        "utf8",
      ).toString("base64"),
    },
    {
      name: "harness-acceptance-checklist.json",
      mimeType: "application/json",
      contentBase64: Buffer.from(
        JSON.stringify(
          {
            generatedAt: new Date().toISOString(),
            report: acceptanceReport,
          },
          null,
          2,
        ),
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
  if (runtime && typeof runtime === "object") {
    runtime.attachmentMetas = mergeAttachmentMetas(runtime?.attachmentMetas, metas);
  }
  attachArtifactsToAssistantResult(ctx, metas);
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
      JSON.stringify(report, null, 2),
    ].filter(Boolean).join("\n");
    appendCapabilityLog(ctx, {
      domain: CAPABILITY_DOMAIN.ACCEPTANCE,
      event: "forced_acceptance_triggered",
    });
    return true;
  }
  return false;
}
