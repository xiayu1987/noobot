/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { WORKFLOW_PARAMS } from "../../../core/workflow-params.js";
import {
  ACCEPTANCE_MODE,
  CAPABILITY_DOMAIN,
  HARNESS_I18N_KEYSET,
  LOCALE,
  appendCapabilityLog,
  applyTransferPayloadToMessage,
  attachTransferPayloadToLatestInjectedMessage,
  ensureHarnessBucket,
  normalizeTransferPayload,
  relaySeparateModelOutputAsUserMessage,
  saveCapabilityOutputAsTransferArtifacts,
  translateI18nText,
} from "./deps.js";
import { buildAcceptanceReport, renderAcceptanceReportText } from "./report-builder.js";
import { runAcceptanceBySeparateModel } from "./validation-runner.js";
import { text, isObjectLike } from "@noobot/shared/value";

const ACCEPTANCE_EVENTS = WORKFLOW_PARAMS.logging.events.acceptance;

function attachTransferPayloadToFinalOutputTurn(ctx = {}, transferPayload = {}) {
  const normalizedTransferPayload = normalizeTransferPayload(transferPayload);
  if (!normalizedTransferPayload.transferEnvelopes.length) return false;
  const result = ctx?.result && typeof ctx.result === "object" ? ctx.result : null;
  if (!result) return false;
  const turnMessages = Array.isArray(result.turnMessages) ? result.turnMessages : [];
  for (let index = turnMessages.length - 1; index >= 0; index -= 1) {
    const item = turnMessages[index] || {};
    if (text(item?.role) !== "assistant") continue;
    turnMessages[index] = applyTransferPayloadToMessage({ ...item }, normalizedTransferPayload);
    return true;
  }
  applyTransferPayloadToMessage(result, normalizedTransferPayload);
  return true;
}

export async function maybeAttachChecklistArtifactsAtFinalOutput(ctx = {}) {
  const holder = ensureHarnessBucket(ctx);
  if (!holder) return false;
  const { bucket, state } = holder;
  if (state.flags.checklistArtifactsAttached === true) return false;

  const locale = state.locale || LOCALE.ZH_CN;
  const acceptanceReport =
    bucket.lastAcceptanceReport ||
    buildAcceptanceReport({
      bucket,
      state,
      mode: ACCEPTANCE_MODE.FORCED,
      forcedReason: [
        translateI18nText(
          locale,
          HARNESS_I18N_KEYSET.ACCEPTANCE_FINAL_OUTPUT.FORCED_REASON_REBUILT_ARTIFACTS,
        ),
        translateI18nText(
          LOCALE.EN_US,
          HARNESS_I18N_KEYSET.ACCEPTANCE_FINAL_OUTPUT.FORCED_REASON_REBUILT_ARTIFACTS,
        ),
      ]
        .filter(Boolean)
        .join(" | "),
    });

  let transferPayload = { transferEnvelopes: [] };
  try {
    const generatedAt = new Date().toISOString();
    const outputs = await Promise.all([
      saveCapabilityOutputAsTransferArtifacts(ctx, {
        purpose: "acceptance_plan",
        name: "harness-plan-text.txt",
        mimeType: "text/plain",
        generationSource: "harness_checklist",
        domain: CAPABILITY_DOMAIN.ACCEPTANCE,
        content: [generatedAt, "[planText]", text(bucket.planText)].filter(Boolean).join("\n"),
      }),
      saveCapabilityOutputAsTransferArtifacts(ctx, {
        purpose: "acceptance_report",
        name: "harness-acceptance-report.txt",
        mimeType: "text/plain",
        generationSource: "harness_checklist",
        domain: CAPABILITY_DOMAIN.ACCEPTANCE,
        content: [generatedAt, renderAcceptanceReportText(acceptanceReport, locale)]
          .filter(Boolean)
          .join("\n\n"),
      }),
    ]);
    transferPayload = normalizeTransferPayload({
      transferEnvelopes: outputs.flatMap((item = {}) => item.transferEnvelopes || []),
    });
  } catch (error) {
    appendCapabilityLog(ctx, {
      domain: CAPABILITY_DOMAIN.ACCEPTANCE,
      event: ACCEPTANCE_EVENTS.checklistArtifactAttachFailed,
      detail: { error: String(error?.message || error || "") },
    });
    return false;
  }

  if (!transferPayload.transferEnvelopes.length) return false;
  const attachedToInjectedMessage = attachTransferPayloadToLatestInjectedMessage(
    ctx,
    transferPayload,
  );
  const attachedToFinalOutput = attachTransferPayloadToFinalOutputTurn(ctx, transferPayload);
  if (!attachedToInjectedMessage && !attachedToFinalOutput) {
    relaySeparateModelOutputAsUserMessage(ctx, {
      locale,
      purpose: "acceptance_checklist",
      content: translateI18nText(
        locale,
        HARNESS_I18N_KEYSET.ACCEPTANCE_FINAL_OUTPUT.CHECKLIST_ARTIFACTS_GENERATED_NOTICE,
      ),
      dedupe: true,
      transferPayload,
    });
  }
  state.flags.checklistArtifactsAttached = true;
  appendCapabilityLog(ctx, {
    domain: CAPABILITY_DOMAIN.ACCEPTANCE,
    event: ACCEPTANCE_EVENTS.checklistArtifactsAttached,
    detail: { attachmentCount: transferPayload.transferEnvelopes.length },
  });
  return true;
}

export async function maybeForceAcceptanceAtFinalOutput(ctx = {}, meta = {}) {
  const holder = ensureHarnessBucket(ctx);
  if (!holder) return false;
  const { bucket, state } = holder;
  if (state.flags.acceptanceRequested === true) return false;
  const locale = state.locale || LOCALE.ZH_CN;
  const forcedReason =
    state.flags.overflowForceAcceptancePending === true
      ? [
          translateI18nText(
            locale,
            HARNESS_I18N_KEYSET.ACCEPTANCE_FINAL_OUTPUT.FORCED_REASON_OVERFLOW_FALLBACK,
          ),
          translateI18nText(
            LOCALE.EN_US,
            HARNESS_I18N_KEYSET.ACCEPTANCE_FINAL_OUTPUT.FORCED_REASON_OVERFLOW_FALLBACK,
          ),
        ]
          .filter(Boolean)
          .join(" | ")
      : [
          translateI18nText(
            locale,
            HARNESS_I18N_KEYSET.ACCEPTANCE_FINAL_OUTPUT.FORCED_REASON_NO_ACTIVE_REQUEST,
          ),
          translateI18nText(
            LOCALE.EN_US,
            HARNESS_I18N_KEYSET.ACCEPTANCE_FINAL_OUTPUT.FORCED_REASON_NO_ACTIVE_REQUEST,
          ),
        ]
          .filter(Boolean)
          .join(" | ");
  const report = buildAcceptanceReport({
    bucket,
    state,
    mode: ACCEPTANCE_MODE.FORCED,
    forcedReason,
  });
  bucket.lastAcceptanceReport = report;
  bucket.acceptanceReports.push(report);
  if (isObjectLike(ctx?.result)) {
    await runAcceptanceBySeparateModel(ctx, meta, report);
    appendCapabilityLog(ctx, {
      domain: CAPABILITY_DOMAIN.ACCEPTANCE,
      event: ACCEPTANCE_EVENTS.forcedAcceptanceTriggered,
      detail: { forcedReason },
    });
    return true;
  }
  return false;
}

export async function maybeRefreshAcceptanceReportBeforeFinalOutput(
  ctx = {},
  meta = {},
  { phaseAcceptanceChanged = false } = {},
) {
  const holder = ensureHarnessBucket(ctx);
  if (!holder) return false;
  const { bucket, state } = holder;
  if (state.flags.acceptanceRequested !== true) return false;
  const lastReport = bucket.lastAcceptanceReport;
  if (!lastReport) return false;

  const latestPhaseReport = bucket.phaseAcceptanceReports.at(-1);
  const latestPhaseAcceptedAt = text(latestPhaseReport?.acceptedAt);
  const reportPhaseAcceptedAt = text(lastReport.modelAcceptance?.acceptedAt);
  const shouldRefresh =
    phaseAcceptanceChanged === true ||
    (latestPhaseAcceptedAt && latestPhaseAcceptedAt !== reportPhaseAcceptedAt);
  if (!shouldRefresh) return false;

  const refreshedReport = buildAcceptanceReport({
    bucket,
    state,
    mode: lastReport.mode || ACCEPTANCE_MODE.ACTIVE,
    forcedReason: text(lastReport.forcedReason),
  });
  bucket.lastAcceptanceReport = refreshedReport;
  if (bucket.acceptanceReports.length) {
    bucket.acceptanceReports[bucket.acceptanceReports.length - 1] = refreshedReport;
  } else {
    bucket.acceptanceReports = [refreshedReport];
  }
  await runAcceptanceBySeparateModel(ctx, meta, refreshedReport);
  return true;
}
