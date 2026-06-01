/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { WORKFLOW_PARAMS } from "../../../core/workflow-params.js";
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
import { injectMessageWithPolicy } from "../shared/message/injection-utils.js";
import { buildPlanChecklistSystemContent } from "../shared/plan/checklist-context.js";
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
  resolveRefinementTargetMainStepIndexesAfterRevision,
  resolveRefinementTargetMainSteps,
} from "./revision-engine.js";
import {
  buildPostPlanUserFollowupPrompt,
  buildWorkflowResponsibilityConstraintUserPrompt,
} from "../shared/workflow/prompts.js";

const GUIDANCE_EVENTS = WORKFLOW_PARAMS.logging.events.guidance;

export function schedulePlanUpdateByInject(
  ctx = {},
  summaryText = "",
  stage = "revision",
  { targetMainStepIndexes = [] } = {},
) {
  const holder = ensureHarnessBucket(ctx);
  if (!holder) return false;
  const { bucket, state } = holder;
  const normalizedStage =
    String(stage || "revision").trim().toLowerCase() === "revision"
      ? "revision"
      : "refinement";
  const normalizedPreferredTargetMainStepIndexes = Array.isArray(targetMainStepIndexes)
    ? targetMainStepIndexes.map((item) => Number(item)).filter((item) => Number.isFinite(item) && item > 0)
    : [];
  const targetMainSteps =
    normalizedStage === "refinement"
      ? resolveRefinementTargetMainSteps(bucket, state, {
          preferredTargetMainStepIndexes: normalizedPreferredTargetMainStepIndexes,
        })
      : [];
  if (normalizedStage === "refinement" && !targetMainSteps.length) {
    appendCapabilityLog(ctx, {
      domain: CAPABILITY_DOMAIN.PLANNING,
      event: GUIDANCE_EVENTS.refinementConvergedNoTargetMainStep,
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
        ? GUIDANCE_EVENTS.revisionScheduledByInject
        : GUIDANCE_EVENTS.refinementScheduledByInject,
    setPendingData: ({ state }) => {
      const normalizedTargetMainStepIndexes =
        normalizedStage === "refinement" ? targetMainSteps.map((item) => item.index) : [];
      setPendingPlanUpdate(state, {
        active: true,
        stage: normalizedStage,
        summaryText,
        targetMainStepIndexes: normalizedTargetMainStepIndexes,
      });
      setPendingStateWithMeta(
        state,
        normalizedStage === "revision" ? "planRevision" : "planRefinement",
        true,
      );
      return true;
    },
    buildScheduledDetail: ({ bucket, state }) => ({
      stage: normalizedStage,
      hasSummaryText: Boolean(String(summaryText || "").trim()),
      refinementTargetMainStepIndexes:
        normalizedStage === "refinement" ? targetMainSteps.map((item = {}) => Number(item?.index)) : [],
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
  injectMessageWithPolicy(ctx, {
    role: "user",
    content: buildWorkflowResponsibilityConstraintUserPrompt(
      locale,
      pendingData.stage === "revision" ? "revision" : "refinement",
    ),
    injectAt: "append",
    dedupe: false,
    avoidBreakToolCallContinuity: true,
  });
  setPendingStateWithMeta(
    state,
    pendingData.stage === "revision" ? "planRevision" : "planRefinement",
    false,
  );
  setPendingPlanUpdate(state, { active: false, stage: pendingData.stage });
  setCaptureFlagStateWithMeta(state, "planUpdateCapturePending", true);
  writePlanUpdateCaptureContext(state, pendingData);
  appendCapabilityLog(ctx, {
    domain: CAPABILITY_DOMAIN.PLANNING,
    event: GUIDANCE_EVENTS.planUpdatePromptInjected,
  });
  return true;
}

export async function maybeCapturePlanUpdateByInject(ctx = {}) {
  return captureInjectedResult(ctx, {
    domain: CAPABILITY_DOMAIN.PLANNING,
    completedEvent: GUIDANCE_EVENTS.planUpdateCaptureCompletedInject,
    failedEvent: GUIDANCE_EVENTS.planUpdateCaptureFailedInject,
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
        relaySeparateModelOutputAsUserMessage(currentCtx, {
          locale,
          purpose:
            stage === "revision"
              ? "next_phase_plan_followup"
              : "next_phase_plan_refinement_followup",
          content: buildPostPlanUserFollowupPrompt(locale, stage),
          dedupe: true,
        });
      }
      if (stage === "revision") {
        const refinementTargetMainStepIndexes = resolveRefinementTargetMainStepIndexesAfterRevision(
          bucket,
          state,
        );
        const scheduled = applied
          ? schedulePlanUpdateByInject(
            currentCtx,
            captureMeta?.summaryText || "",
            "refinement",
            { targetMainStepIndexes: refinementTargetMainStepIndexes },
          )
          : false;
        return {
          applied: applied || scheduled,
          detail: {
            stage,
            revisionApplied: applied === true,
            refinementScheduled: scheduled === true,
            refinementTargetMainStepIndexes,
            checklistCount: Array.isArray(bucket.taskChecklist) ? bucket.taskChecklist.length : 0,
          },
        };
      }
      return {
        applied,
        detail: {
          stage,
          refinementTargetMainStepIndexes: Array.isArray(captureMeta?.targetMainStepIndexes)
            ? captureMeta.targetMainStepIndexes
            : [],
          checklistCount: Array.isArray(bucket.taskChecklist) ? bucket.taskChecklist.length : 0,
        },
      };
    },
  });
}
