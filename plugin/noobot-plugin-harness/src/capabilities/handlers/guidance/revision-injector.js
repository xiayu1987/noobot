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
  scheduleInjectTask,
} from "../inject-fallback.js";
import { setCaptureFlagStateWithMeta, setPendingStateWithMeta } from "../../pending-cleanup.js";
import { injectMessageWithPolicy } from "../shared/message-injection-utils.js";
import { buildPlanChecklistSystemContent } from "../shared/plan-checklist-context.js";
import { resolvePendingPlanUpdate } from "./plan-update-scheduler.js";
import {
  canAttemptPlanUpdate,
  clearPlanUpdateCaptureContext,
  readPlanUpdateCaptureContext,
  setPendingPlanUpdate,
  writePlanUpdateCaptureContext,
} from "./plan-update-engine.js";
import {
  applyRevisedPlanFromText,
  buildNextPhaseRelayContent,
  buildPlanningRefinementPrompt,
  buildPlanningRevisionPrompt,
  resolveRefinementTargetMainSteps,
} from "./revision-engine.js";

export function schedulePlanUpdateByInject(ctx = {}, summaryText = "", stage = "revision") {
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
  if (!canAttemptPlanUpdate(ctx, state, { increment: false, stage: normalizedStage })) {
    return false;
  }
  return scheduleInjectTask(ctx, {
    domain: CAPABILITY_DOMAIN.PLANNING,
    scheduledEvent:
      normalizedStage === "revision"
        ? "planning_revision_scheduled_by_inject"
        : "planning_refinement_scheduled_by_inject",
    setPendingData: ({ state }) => {
      setPendingStateWithMeta(state, "planUpdate", true);
      const normalizedTargetMainStepIndexes =
        normalizedStage === "refinement" ? targetMainSteps.map((item) => item.index) : [];
      setPendingPlanUpdate(state, {
        active: true,
        stage: normalizedStage,
        summaryText,
        targetMainStepIndexes: normalizedTargetMainStepIndexes,
      });
      return true;
    },
    buildScheduledDetail: ({ bucket, state }) => ({
      stage: normalizedStage,
      hasSummaryText: Boolean(
        state.pending?.planUpdateContext?.summaryText || state.pending.summaryText,
      ),
      checklistCount: Array.isArray(bucket.taskChecklist) ? bucket.taskChecklist.length : 0,
    }),
  });
}

export function maybeInjectPlanUpdatePrompt(ctx = {}) {
  const holder = ensureHarnessBucket(ctx);
  if (!holder) return false;
  const { bucket, state } = holder;
  const pendingData = resolvePendingPlanUpdate(state);
  if (!pendingData?.active) return false;
  const messages = Array.isArray(ctx?.messages) ? ctx.messages : null;
  if (!messages) return false;
  const locale = state?.locale || LOCALE.ZH_CN;
  const systemChecklistContent = buildPlanChecklistSystemContent({
    locale,
    planText: bucket?.planText || "",
    bucket,
  });
  if (systemChecklistContent) {
    injectMessageWithPolicy(ctx, {
      role: "system",
      content: systemChecklistContent,
      injectAt: "append",
      dedupe: false,
      avoidBreakToolCallContinuity: true,
    });
  }
  const promptContent =
    pendingData.stage === "revision"
      ? buildPlanningRevisionPrompt(locale, bucket, state, pendingData.summaryText || "")
      : buildPlanningRefinementPrompt(locale, bucket, state, pendingData.summaryText || "");
  const userInjection = injectMessageWithPolicy(ctx, {
    role: "user",
    content: String(promptContent || "").trim(),
    injectAt: "append",
    dedupe: false,
    avoidBreakToolCallContinuity: true,
  });
  if (!userInjection.injected) return false;
  setPendingStateWithMeta(state, "planUpdate", false);
  setPendingPlanUpdate(state, { active: false });
  setCaptureFlagStateWithMeta(state, "planUpdateCapturePending", true);
  writePlanUpdateCaptureContext(state, pendingData);
  appendCapabilityLog(ctx, {
    domain: CAPABILITY_DOMAIN.PLANNING,
    event: "planning_plan_update_prompt_injected",
  });
  return true;
}

export async function maybeCapturePlanUpdateByInject(ctx = {}) {
  return captureInjectedResult(ctx, {
    domain: CAPABILITY_DOMAIN.PLANNING,
    completedEvent: "planning_plan_update_capture_completed_inject",
    failedEvent: "planning_plan_update_capture_failed_inject",
    isCapturePending: ({ state }) => state.flags.planUpdateCapturePending === true,
    consumeCaptureMeta: ({ state }) => {
      const { stage, summaryText, targetMainStepIndexes } = readPlanUpdateCaptureContext(state);
      setCaptureFlagStateWithMeta(state, "planUpdateCapturePending", false);
      clearPlanUpdateCaptureContext(state);
      return { stage, summaryText, targetMainStepIndexes };
    },
    applyCaptureResult: ({ responseText, ctx: currentCtx, state, bucket, captureMeta }) => {
      const stage = captureMeta?.stage === "revision" ? "revision" : "refinement";
      if (!canAttemptPlanUpdate(currentCtx, state, { increment: true, stage })) {
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
          ? schedulePlanUpdateByInject(currentCtx, captureMeta?.summaryText || "", "refinement")
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
