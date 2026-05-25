/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import {
  CAPABILITY_DOMAIN,
  LOCALE,
  appendCapabilityLog,
  ensureHarnessBucket,
  relaySeparateModelOutputAsUserMessage,
} from "./deps.js";
import {
  captureInjectedResult,
  injectScheduledPrompt,
  scheduleInjectTask,
} from "../inject-fallback.js";
import { setCaptureFlagStateWithMeta, setPendingStateWithMeta } from "../../pending-cleanup.js";
import {
  applyRevisedPlanFromText,
  buildNextPhaseRelayContent,
  buildPlanningRefinementPrompt,
  buildPlanningRevisionPrompt,
  canAttemptPlanRevision,
  resolveRefinementTargetMainSteps,
} from "./revision-engine.js";

export function schedulePlanRevisionByInject(ctx = {}, summaryText = "", stage = "revision") {
  const holder = ensureHarnessBucket(ctx);
  if (!holder) return false;
  const { bucket, state } = holder;
  const normalizedStage =
    String(stage || "revision").trim().toLowerCase() === "revision"
      ? "revision"
      : "refinement";
  const targetMainSteps =
    normalizedStage === "refinement" ? resolveRefinementTargetMainSteps(bucket, state) : [];
  if (normalizedStage === "refinement" && !targetMainSteps.length) {
    appendCapabilityLog(ctx, {
      domain: CAPABILITY_DOMAIN.PLANNING,
      event: "planning_refinement_converged_no_target_main_step",
    });
    return false;
  }
  if (normalizedStage === "revision" && !canAttemptPlanRevision(ctx, state, { increment: false })) {
    return false;
  }
  return scheduleInjectTask(ctx, {
    domain: CAPABILITY_DOMAIN.PLANNING,
    scheduledEvent:
      normalizedStage === "revision"
        ? "planning_revision_scheduled_by_inject"
        : "planning_refinement_scheduled_by_inject",
    setPendingData: ({ state }) => {
      setPendingStateWithMeta(state, "planRevision", true);
      state.pending.planRevisionStage = normalizedStage;
      state.pending.summaryText = String(summaryText || "").trim();
      state.pending.planRevisionTargetMainStepIndexes =
        normalizedStage === "refinement" ? targetMainSteps.map((item) => item.index) : [];
      return true;
    },
    buildScheduledDetail: ({ bucket, state }) => ({
      stage: normalizedStage,
      hasSummaryText: Boolean(state.pending.summaryText),
      checklistCount: Array.isArray(bucket.taskChecklist) ? bucket.taskChecklist.length : 0,
    }),
  });
}

export function maybeInjectPlanRevisionPrompt(ctx = {}) {
  return injectScheduledPrompt(ctx, {
    domain: CAPABILITY_DOMAIN.PLANNING,
    injectedEvent: "planning_plan_update_prompt_injected",
    getPendingData: ({ state }) =>
      state.pending.planRevision === true
        ? {
            summaryText: String(state.pending.summaryText || "").trim(),
            stage:
              String(state.pending.planRevisionStage || "refinement").trim().toLowerCase() === "revision"
                ? "revision"
                : "refinement",
            targetMainStepIndexes: Array.isArray(state.pending.planRevisionTargetMainStepIndexes)
              ? state.pending.planRevisionTargetMainStepIndexes
              : [],
          }
        : null,
    consumePendingData: ({ state }) => {
      setPendingStateWithMeta(state, "planRevision", false);
      delete state.pending.planRevisionStage;
      delete state.pending.planRevisionTargetMainStepIndexes;
    },
    markCapturePending: ({ state, pendingData }) => {
      setCaptureFlagStateWithMeta(state, "planRevisionCapturePending", true);
      state.flags.planRevisionCaptureStage =
        String(pendingData?.stage || "refinement").trim().toLowerCase() === "revision"
          ? "revision"
          : "refinement";
      state.flags.planRevisionCaptureSummaryText = String(pendingData?.summaryText || "").trim();
      state.flags.planRevisionCaptureTargetMainStepIndexes = Array.isArray(pendingData?.targetMainStepIndexes)
        ? pendingData.targetMainStepIndexes
        : [];
    },
    buildPromptContent: ({ locale, bucket, state, pendingData }) =>
      pendingData.stage === "revision"
        ? buildPlanningRevisionPrompt(locale, bucket, state, pendingData.summaryText || "")
        : buildPlanningRefinementPrompt(locale, bucket, state, pendingData.summaryText || ""),
    messageRole: "user",
    injectAt: "append",
  });
}

export async function maybeCapturePlanRevisionByInject(ctx = {}) {
  return captureInjectedResult(ctx, {
    domain: CAPABILITY_DOMAIN.PLANNING,
    completedEvent: "planning_plan_update_capture_completed_inject",
    failedEvent: "planning_plan_update_capture_failed_inject",
    isCapturePending: ({ state }) => state.flags.planRevisionCapturePending === true,
    consumeCaptureMeta: ({ state }) => {
      const stage =
        String(state.flags.planRevisionCaptureStage || "refinement").trim().toLowerCase() === "revision"
          ? "revision"
          : "refinement";
      const summaryText = String(state.flags.planRevisionCaptureSummaryText || "").trim();
      const targetMainStepIndexes = Array.isArray(state.flags.planRevisionCaptureTargetMainStepIndexes)
        ? state.flags.planRevisionCaptureTargetMainStepIndexes
        : [];
      setCaptureFlagStateWithMeta(state, "planRevisionCapturePending", false);
      delete state.flags.planRevisionCaptureStage;
      delete state.flags.planRevisionCaptureSummaryText;
      delete state.flags.planRevisionCaptureTargetMainStepIndexes;
      return { stage, summaryText, targetMainStepIndexes };
    },
    applyCaptureResult: ({ responseText, ctx: currentCtx, state, bucket, captureMeta }) => {
      const stage = captureMeta?.stage === "revision" ? "revision" : "refinement";
      if (stage === "revision" && !canAttemptPlanRevision(currentCtx, state, { increment: true })) {
        return { applied: false, detail: { stage, reason: "max_revision_attempts" } };
      }
      const applied = applyRevisedPlanFromText(currentCtx, responseText, {
        source: stage === "revision" ? "planning_revision_inject" : "planning_refinement_inject",
        summary: captureMeta?.summaryText || "",
        stage,
        targetMainStepIndexes: Array.isArray(captureMeta?.targetMainStepIndexes)
          ? captureMeta.targetMainStepIndexes
          : [],
      });
      const locale = state?.locale || LOCALE.ZH_CN;
      if (applied) {
        relaySeparateModelOutputAsUserMessage(currentCtx, {
          locale,
          purpose: stage === "revision" ? "next_phase_plan" : "next_phase_plan_refinement",
          content: buildNextPhaseRelayContent(bucket, locale, stage),
          dedupe: true,
        });
      }
      if (stage === "revision") {
        const mainPlanChanged = bucket?.lastMainPlanRevisionChanged === true;
        const scheduled = mainPlanChanged
          ? schedulePlanRevisionByInject(currentCtx, captureMeta?.summaryText || "", "refinement")
          : false;
        if (!mainPlanChanged && applied) {
          appendCapabilityLog(currentCtx, {
            domain: CAPABILITY_DOMAIN.PLANNING,
            event: "planning_refinement_skipped_no_main_plan_change",
          });
        }
        return {
          applied: applied || scheduled,
          detail: {
            stage,
            revisionApplied: applied === true,
            refinementScheduled: scheduled === true,
            mainPlanChanged,
            checklistCount: Array.isArray(bucket.taskChecklist) ? bucket.taskChecklist.length : 0,
          },
        };
      }
      return {
        applied,
        detail: {
          stage,
          checklistCount: Array.isArray(bucket.taskChecklist) ? bucket.taskChecklist.length : 0,
        },
      };
    },
  });
}
