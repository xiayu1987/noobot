/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { WORKFLOW_PARAMS } from "../../../core/workflow-params.js";
import { resolveModelMessages } from "../../../core/message-store.js";
import {
  CAPABILITY_DOMAIN,
  LOCALE,
  appendCapabilityLog,
  ensureHarnessBucket,
  relaySeparateModelOutputAsUserMessage,
} from "./deps.js";
import { captureInjectedResult, scheduleInjectTask } from "../inject-fallback.js";
import { setCaptureFlagStateWithMeta, setPendingStateWithMeta } from "../../pending-cleanup.js";
import { injectMessageWithPolicy } from "../shared/message/injection-utils.js";
import { buildPlanChecklistSystemContent } from "../shared/plan/checklist-context.js";
import { parseMainPlansFromPlanText } from "../shared/plan/text-protocol.js";
import { resolvePendingPlanUpdate } from "../planning/plan-update-scheduler.js";
import {
  canAttemptPlanUpdate,
  normalizePlanUpdateStage,
  readPlanUpdateCaptureContext,
  setPendingPlanUpdate,
  writePlanUpdateCaptureContext,
} from "../planning/plan-update-engine.js";
import {
  applyRevisedPlanFromText,
  buildNextPhaseRelayContent,
  buildPlanningRefinementPrompt,
  buildPlanningRevisionPrompt,
  resolveRefinementTargetMainStepIndexesAfterRevision,
  resolveRefinementTargetMainSteps,
} from "../planning/revision-engine.js";
import {
  buildPostPlanUserFollowupPrompt,
  buildWorkflowResponsibilityConstraintUserPrompt,
  resolveScenarioPolicyFlagsFromContext,
} from "../shared/workflow/prompts.js";
import {
  formatOperationDirectoryForRelay,
  resolveOperationDirectoryContext,
} from "../shared/operation-directory.js";
import { applyDynamicPolicyPromptFromText } from "../shared/workflow/dynamic-policy-prompt.js";
import { text } from "@noobot/shared/value";

const GUIDANCE_EVENTS = WORKFLOW_PARAMS.logging.events.guidance;

export function schedulePlanUpdateByInject(
  ctx = {},
  stage = "revision",
  { targetMainStepIndexes = [] } = {},
) {
  const holder = ensureHarnessBucket(ctx);
  if (!holder) return false;
  const { bucket, state } = holder;
  const normalizedStage = normalizePlanUpdateStage(stage);
  const normalizedPreferredTargetMainStepIndexes = Array.isArray(targetMainStepIndexes)
    ? targetMainStepIndexes
        .map((item) => Number(item))
        .filter((item) => Number.isFinite(item) && item > 0)
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
        targetMainStepIndexes: normalizedTargetMainStepIndexes,
      });
      setPendingStateWithMeta(
        state,
        normalizedStage === "revision" ? "planRevision" : "planRefinement",
        true,
      );
      return true;
    },
    buildScheduledDetail: ({ bucket }) => ({
      stage: normalizedStage,
      refinementTargetMainStepIndexes:
        normalizedStage === "refinement"
          ? targetMainSteps.map((item = {}) => Number(item?.index))
          : [],
      checklistCount: parseMainPlansFromPlanText(bucket.planText).length,
    }),
  });
}

export function maybeInjectPlanUpdatePrompt(ctx = {}, meta = {}) {
  const holder = ensureHarnessBucket(ctx);
  if (!holder) return false;
  const { bucket, state } = holder;
  const pendingData = resolvePendingPlanUpdate(state);
  if (!pendingData?.active) return false;
  const messages = resolveModelMessages(ctx);
  if (!messages) return false;
  const locale = state?.locale || LOCALE.ZH_CN;
  const isRevision = pendingData.stage === "revision";
  const targetMainStepIndexes = isRevision
    ? []
    : resolveRefinementTargetMainSteps(bucket, state).map((item = {}) => Number(item?.index));
  if (!isRevision && !targetMainStepIndexes.length) {
    setPendingStateWithMeta(state, "planRefinement", false);
    setPendingPlanUpdate(state, { active: false, stage: pendingData.stage });
    appendCapabilityLog(ctx, {
      domain: CAPABILITY_DOMAIN.PLANNING,
      event: GUIDANCE_EVENTS.refinementConvergedNoTargetMainStep,
    });
    return false;
  }
  const { programmingMode, textMode, dynamicPolicyPrompt } = resolveScenarioPolicyFlagsFromContext(
    ctx,
    meta,
  );
  const systemChecklistContent = buildPlanChecklistSystemContent({
    locale,
    planText: bucket?.planText,
    bucket,
  });
  if (systemChecklistContent) {
    injectMessageWithPolicy(ctx, {
      role: "system",
      content: systemChecklistContent,
      injectedMessageType: "planning_revision_checklist",
      injectAt: "append",
      dedupe: false,
      avoidBreakToolCallContinuity: true,
    });
  }
  const promptContent = isRevision
    ? buildPlanningRevisionPrompt(locale, bucket, state)
    : buildPlanningRefinementPrompt(locale, bucket, state, { targetMainStepIndexes });
  const userInjection = injectMessageWithPolicy(ctx, {
    role: "user",
    content: text(promptContent),
    injectedMessageType:
      pendingData.stage === "revision" ? "planning_revision_prompt" : "planning_refinement_prompt",
    injectAt: "append",
    dedupe: false,
    avoidBreakToolCallContinuity: true,
  });
  if (!userInjection.injected) return false;
  injectMessageWithPolicy(ctx, {
    role: "user",
    content: buildWorkflowResponsibilityConstraintUserPrompt(locale, pendingData.stage, {
      programmingMode,
      textMode,
      dynamicPolicyPrompt,
      includeWorkflowPolicy: false,
    }),
    injectedMessageType:
      pendingData.stage === "revision"
        ? "planning_revision_responsibility_constraint"
        : "planning_refinement_responsibility_constraint",
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
  writePlanUpdateCaptureContext(state, { stage: pendingData.stage, targetMainStepIndexes });
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
      const { stage, targetMainStepIndexes } = readPlanUpdateCaptureContext(state);
      setCaptureFlagStateWithMeta(state, "planUpdateCapturePending", false);
      return { stage, targetMainStepIndexes };
    },
    applyCaptureResult: ({ responseText, ctx: currentCtx, state, bucket, captureMeta }) => {
      const { stage } = captureMeta;
      if (!canAttemptPlanUpdate(currentCtx, state, { increment: true, stage })) {
        return { applied: false, detail: { stage, reason: "max_revision_attempts" } };
      }
      applyDynamicPolicyPromptFromText(currentCtx, responseText, {
        source: stage === "revision" ? "planning_revision_inject" : "planning_refinement_inject",
        stage,
      });
      const applied = applyRevisedPlanFromText(currentCtx, responseText, {
        source: stage === "revision" ? "planning_revision_inject" : "planning_refinement_inject",
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
          content: [
            buildPostPlanUserFollowupPrompt(locale, stage),
            stage === "refinement"
              ? formatOperationDirectoryForRelay(resolveOperationDirectoryContext(currentCtx))
              : "",
          ]
            .filter(Boolean)
            .join("\n\n"),
          dedupe: true,
        });
      }
      if (stage === "revision") {
        const refinementTargetMainStepIndexes =
          resolveRefinementTargetMainStepIndexesAfterRevision(bucket);
        const scheduled = applied
          ? schedulePlanUpdateByInject(currentCtx, "refinement", {
              targetMainStepIndexes: refinementTargetMainStepIndexes,
            })
          : false;
        return {
          applied: applied || scheduled,
          detail: {
            stage,
            revisionApplied: applied === true,
            refinementScheduled: scheduled === true,
            refinementTargetMainStepIndexes,
            checklistCount: parseMainPlansFromPlanText(bucket.planText).length,
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
          checklistCount: parseMainPlansFromPlanText(bucket.planText).length,
        },
      };
    },
  });
}
