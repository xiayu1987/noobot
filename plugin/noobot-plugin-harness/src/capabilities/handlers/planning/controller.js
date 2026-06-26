/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { ensureTaskAcceptanceTool } from "../acceptance.js";
import { setPendingStateWithMeta } from "../../pending-cleanup.js";
import { WORKFLOW_PARAMS } from "../../../core/workflow-params.js";
import {
  CAPABILITY_DOMAIN,
  appendCapabilityLog,
  disableBlockedToolsInRegistry,
  ensureHarnessBucket,
  sanitizeInternalMessages,
  shouldUseSeparateModel,
} from "./deps.js";
import { ensurePlanRefinementTool } from "./tool-injector.js";
import { maybeInjectPlanningPrompt } from "./prompt-builder.js";
import { maybeCapturePlanningResult, runPlanningBySeparateModel } from "./capture-runner.js";
import { canAttemptPlanUpdate, setPendingPlanUpdate } from "./plan-update-engine.js";
import { resolvePendingPlanUpdate } from "./plan-update-scheduler.js";
import { LOCALE } from "../shared/constants.js";
import { translateI18nText } from "../shared/i18n.js";
import {
  resolveWorkflowMode,
  runWorkflowLifecycle,
} from "../shared/workflow/pattern.js";
import { resolveWorkflowThresholdModeFromContext } from "../shared/workflow/prompts.js";
import { enforceWorkflowInvariants } from "../shared/workflow/invariants.js";

const TASK_SUMMARY_TOOL_NAME = WORKFLOW_PARAMS.planning.tools.summaryToolName;
const PLANNING_DECISION = WORKFLOW_PARAMS.planning.decisions;
const PLANNING_EVENTS = WORKFLOW_PARAMS.logging.events.planning;
const ACCEPTANCE_EVENTS = WORKFLOW_PARAMS.logging.events.acceptance;
const DEFAULT_PLAN_UPDATE_TRIGGER_TURNS_THRESHOLD = WORKFLOW_PARAMS.planning.planUpdate.triggerTurnsThreshold;
const DEFAULT_PHASE_ACCEPTANCE_TRIGGER_TURNS_THRESHOLD =
  WORKFLOW_PARAMS.acceptance.phase.triggerTurnsThreshold;
const PLANNING_THRESHOLD_SNAPSHOT_EVENT = "planning_threshold_snapshot";

function normalizePositiveInteger(value = 0, fallback = 0) {
  const num = Number(value);
  if (!Number.isFinite(num) || num <= 0) return fallback;
  return Math.floor(num);
}

function resolvePlanningTurnThresholds(ctx = {}) {
  const modeThresholds = WORKFLOW_PARAMS.modeThresholds || {};
  const thresholdMode = resolveWorkflowThresholdModeFromContext(ctx);
  const scopedMode = modeThresholds[thresholdMode] || modeThresholds.full;
  const scoped = scopedMode?.planning || {};
  const scopedGuidance = scopedMode?.guidance || {};
  return {
    mode: modeThresholds[thresholdMode] ? thresholdMode : "full",
    planUpdateTriggerTurnsThreshold: normalizePositiveInteger(
      scoped?.planUpdate?.triggerTurnsThreshold,
      DEFAULT_PLAN_UPDATE_TRIGGER_TURNS_THRESHOLD,
    ),
    phaseAcceptanceTriggerTurnsThreshold: normalizePositiveInteger(
      scopedMode?.acceptance?.phase?.triggerTurnsThreshold,
      DEFAULT_PHASE_ACCEPTANCE_TRIGGER_TURNS_THRESHOLD,
    ),
  };
}

function isPlanningThresholdDebugEnabled() {
  return globalThis?.process?.env?.HARNESS_DEBUG_THRESHOLDS === "1";
}
const PLANNING_REASON_LABEL_KEY = Object.freeze({
  [PLANNING_DECISION.reason.idle]: "planningReasonIdle",
  [PLANNING_DECISION.reason.planUpdateThreshold]: "planningReasonPlanUpdateThreshold",
  [PLANNING_DECISION.reason.phaseAcceptanceThreshold]: "planningReasonPhaseAcceptanceThreshold",
  [PLANNING_DECISION.reason.afterLlmCapture]: "planningReasonAfterLlmCapture",
});
const PLANNING_BLOCKED_REASON_LABEL_KEY = Object.freeze({
  plan_update_blocked_by_pending_plan_update: "planningBlockedPlanUpdatePending",
  phase_acceptance_blocked_by_higher_priority_pending: "planningBlockedPhaseAcceptanceHigherPriority",
});

function resolvePlanningReasonLabel(locale = LOCALE.ZH_CN, reason = "") {
  const key = PLANNING_REASON_LABEL_KEY[String(reason || "").trim()];
  if (!key) return String(reason || "").trim();
  return translateI18nText(locale, key) || String(reason || "").trim();
}

function resolvePlanningBlockedReasonLabel(locale = LOCALE.ZH_CN, reason = "") {
  const key = PLANNING_BLOCKED_REASON_LABEL_KEY[String(reason || "").trim()];
  if (!key) return String(reason || "").trim();
  return translateI18nText(locale, key) || String(reason || "").trim();
}

function resolvePlanningTriggeredActions({
  planUpdate = false,
  phaseAcceptance = false,
} = {}) {
  const actions = [];
  if (planUpdate) {
    actions.push(PLANNING_DECISION.label.planUpdateRevision);
  }
  if (phaseAcceptance) {
    actions.push(PLANNING_DECISION.label.phaseAcceptance);
  }
  return actions;
}

function consumePlanningTurnIncrement(state = {}, ctx = {}) {
  const counters = state?.counters || {};
  const currentTurn = Number(ctx?.turn);
  const previousTurn = Number(counters.lastPlanningCounterTurn || 0);
  let increment = 1;
  if (Number.isFinite(currentTurn) && currentTurn > 0) {
    increment =
      Number.isFinite(previousTurn) && previousTurn > 0
        ? Math.max(1, Math.trunc(currentTurn) - Math.trunc(previousTurn))
        : 1;
    counters.lastPlanningCounterTurn = Math.trunc(currentTurn);
  }
  return increment;
}

export function createPlanningHandler({ shouldProcessPrimaryToolHooks = () => true } = {}) {
  return async ({ capability, point = "", ctx = {}, meta = {} } = {}) => {
    if (
      ["before_llm_call", "after_llm_call", "after_tool_calls", "before_final_output"].includes(point) &&
      !shouldProcessPrimaryToolHooks(ctx)
    ) {
      return { capability, point, status: "active", changed: false };
    }
    if (point === "before_llm_call") {
      const invariantChanged = enforceWorkflowInvariants(ctx, { domain: CAPABILITY_DOMAIN.PLANNING }) === true;
      let setupChanged = invariantChanged;
      const holder = ensureHarnessBucket(ctx);
      const mode = resolveWorkflowMode(meta);
      let decisionReason = PLANNING_DECISION.reason.idle;
      const blockedActions = [];
      const blockedReasons = [];
      let candidateActions = [];
      let pendingSnapshotRaw = {
        summary: false,
        summaryByCharsPrompted: false,
        guidance: null,
        analysis: false,
        planUpdate: false,
        phaseAcceptance: false,
        planningCaptured: false,
      };
      if (holder) {
        const turnIncrement = consumePlanningTurnIncrement(holder.state, ctx);
        holder.state.counters.llmTurns += turnIncrement;
        holder.state.counters.planUpdateTurns =
          Number(holder.state.counters.planUpdateTurns || 0) + turnIncrement;
        holder.state.counters.phaseAcceptanceTurns =
          Number(holder.state.counters.phaseAcceptanceTurns || 0) + turnIncrement;
        const planningThresholds = resolvePlanningTurnThresholds(ctx);
        const planUpdateTriggerTurnsThreshold = planningThresholds.planUpdateTriggerTurnsThreshold;
        const phaseAcceptanceTriggerTurnsThreshold =
          planningThresholds.phaseAcceptanceTriggerTurnsThreshold;
        const reachedPlanUpdateTurns =
          holder.state.counters.planUpdateTurns >= planUpdateTriggerTurnsThreshold;
        const reachedPhaseAcceptanceTurns =
          holder.state.counters.phaseAcceptanceTurns >= phaseAcceptanceTriggerTurnsThreshold;

        if (isPlanningThresholdDebugEnabled()) {
          appendCapabilityLog(ctx, {
            domain: CAPABILITY_DOMAIN.PLANNING,
            event: PLANNING_THRESHOLD_SNAPSHOT_EVENT,
            detail: {
              thresholdMode: planningThresholds.mode,
              counters: {
                llmTurns: holder.state.counters.llmTurns,
                planUpdateTurns: holder.state.counters.planUpdateTurns,
                phaseAcceptanceTurns: holder.state.counters.phaseAcceptanceTurns,
              },
              thresholds: {
                planUpdateTriggerTurnsThreshold,
                phaseAcceptanceTriggerTurnsThreshold,
              },
              reached: {
                planUpdateTurns: reachedPlanUpdateTurns,
                phaseAcceptanceTurns: reachedPhaseAcceptanceTurns,
              },
            },
          });
        }

        if (reachedPlanUpdateTurns) {
          const blockedByPendingPlanUpdate = resolvePendingPlanUpdate(holder.state).active === true;
          let planUpdateScheduled = false;
          if (
            !blockedByPendingPlanUpdate &&
            canAttemptPlanUpdate(ctx, holder.state, { increment: false, stage: "revision" })
          ) {
            setPendingPlanUpdate(holder.state, {
              active: true,
              stage: "revision",
            });
            setPendingStateWithMeta(holder.state, "planRevision", true);
            appendCapabilityLog(ctx, {
              domain: CAPABILITY_DOMAIN.PLANNING,
              event: PLANNING_EVENTS.revisionScheduledByTurnThreshold,
              detail: {
                triggerTurns: planUpdateTriggerTurnsThreshold,
                thresholdMode: planningThresholds.mode,
                summaryPending: holder.state.pending?.summary === true,
              },
            });
            planUpdateScheduled = true;
            if (decisionReason === PLANNING_DECISION.reason.idle) {
              decisionReason = PLANNING_DECISION.reason.planUpdateThreshold;
            }
          }
          if (planUpdateScheduled) {
            holder.state.counters.planUpdateTurns = 0;
          } else if (blockedByPendingPlanUpdate) {
            // Keep threshold pressure while a prior plan-update is still pending.
            holder.state.counters.planUpdateTurns = planUpdateTriggerTurnsThreshold;
            blockedActions.push(PLANNING_DECISION.label.planUpdateRevision);
            blockedReasons.push("plan_update_blocked_by_pending_plan_update");
          } else {
            holder.state.counters.planUpdateTurns = 0;
          }
        }

        if (reachedPhaseAcceptanceTurns) {
          let phaseAcceptanceScheduled = false;
          if (
            holder.state.flags.planningCaptured === true &&
            holder.state.pending?.phaseAcceptance !== true &&
            holder.state.pending?.summary !== true &&
            !holder.state.pending?.guidance &&
            resolvePendingPlanUpdate(holder.state).active !== true
          ) {
            setPendingStateWithMeta(holder.state, "phaseAcceptance", true);
            phaseAcceptanceScheduled = true;
            appendCapabilityLog(ctx, {
              domain: CAPABILITY_DOMAIN.ACCEPTANCE,
              event: ACCEPTANCE_EVENTS.phaseAcceptanceScheduledByTurnThreshold,
              detail: {
                triggerTurns: phaseAcceptanceTriggerTurnsThreshold,
                thresholdMode: planningThresholds.mode,
                summaryPending: holder.state.pending?.summary === true,
                guidancePending: Boolean(holder.state.pending?.guidance),
                planUpdatePending: resolvePendingPlanUpdate(holder.state).active === true,
              },
            });
          }
          if (phaseAcceptanceScheduled) {
            holder.state.counters.phaseAcceptanceTurns = 0;
            if (decisionReason === PLANNING_DECISION.reason.idle) {
              decisionReason = PLANNING_DECISION.reason.phaseAcceptanceThreshold;
            }
          } else {
            // Keep threshold pressure when blocked by higher-priority flows
            // (summary/guidance/plan-update), so phase acceptance can be
            // scheduled immediately after they are cleared.
            holder.state.counters.phaseAcceptanceTurns = phaseAcceptanceTriggerTurnsThreshold;
            blockedActions.push(WORKFLOW_PARAMS.acceptance.decisions.action.phaseAcceptance);
            blockedReasons.push("phase_acceptance_blocked_by_higher_priority_pending");
          }
        }

        pendingSnapshotRaw = {
          summary: holder.state.pending?.summary === true,
          summaryByCharsPrompted: holder.state.flags?.summaryByCharsPrompted === true,
          guidance: holder.state.pending?.guidance || null,
          analysis: holder.state.pending?.analysis === true,
          planUpdate: resolvePendingPlanUpdate(holder.state).active === true,
          phaseAcceptance: holder.state.pending?.phaseAcceptance === true,
          planningCaptured: holder.state.flags?.planningCaptured === true,
        };
        candidateActions = resolvePlanningTriggeredActions({
          planUpdate: pendingSnapshotRaw.planUpdate,
          phaseAcceptance: pendingSnapshotRaw.phaseAcceptance,
        });
      }

      const planUpdateSnapshot = resolvePendingPlanUpdate(holder?.state || {});
      const normalizedPendingSnapshot = {
        summary: {
          active: pendingSnapshotRaw.summary === true,
          reason: pendingSnapshotRaw.summary === true
            ? (pendingSnapshotRaw.summaryByCharsPrompted === true
              ? PLANNING_DECISION.label.summaryOverflow
              : PLANNING_DECISION.label.summaryTurns)
            : "",
        },
        guidance: {
          active: Boolean(pendingSnapshotRaw.guidance),
          payload: pendingSnapshotRaw.guidance || null,
        },
        analysis: {
          active: pendingSnapshotRaw.analysis === true,
        },
        planUpdate: {
          active: planUpdateSnapshot.active === true,
          stage: planUpdateSnapshot.stage || "",
          context: {
            targetMainStepIndexes: Array.isArray(planUpdateSnapshot.targetMainStepIndexes)
              ? planUpdateSnapshot.targetMainStepIndexes
              : [],
          },
        },
        phaseAcceptance: {
          active: pendingSnapshotRaw.phaseAcceptance === true,
          blockedBy: blockedActions.includes(WORKFLOW_PARAMS.acceptance.decisions.action.phaseAcceptance)
            ? ["summary_or_guidance_or_plan_update_or_planning_not_captured"]
            : [],
        },
        acceptanceSemanticValidation: {
          active: false,
        },
        flags: {
          planningCaptured: pendingSnapshotRaw.planningCaptured === true,
          summaryByCharsPrompted: pendingSnapshotRaw.summaryByCharsPrompted === true,
          overflowForceAcceptancePending: holder?.state?.flags?.overflowForceAcceptancePending === true,
        },
      };

      const lifecycle = await runWorkflowLifecycle(ctx, {
        domain: CAPABILITY_DOMAIN.PLANNING,
        point: "before_llm_call",
        mode,
        resolveDecision: () => ({
          chosenAction: PLANNING_DECISION.action.planningBootstrap,
          chosenReason: decisionReason,
          chosenReasonLabel: resolvePlanningReasonLabel(holder?.state?.locale || LOCALE.ZH_CN, decisionReason),
          candidateActions,
          deferredActions: candidateActions,
          triggeredActions: candidateActions,
          blockedActions,
          blockedReasons,
          blockedReasonLabels: blockedReasons.map((reason) =>
            resolvePlanningBlockedReasonLabel(holder?.state?.locale || LOCALE.ZH_CN, reason),
          ),
          pending: normalizedPendingSnapshot,
        }),
        execute: async () => {
          let changed = setupChanged;
          let planningPrimaryExecuted = false;
          changed = sanitizeInternalMessages(ctx) || changed;
          changed = disableBlockedToolsInRegistry(ctx) || changed;
          changed = ensureTaskAcceptanceTool(ctx, meta) || changed;
          changed = ensurePlanRefinementTool(ctx, meta) || changed;
          if (shouldUseSeparateModel(meta)) {
            const planningSeparateModelChanged = await runPlanningBySeparateModel(ctx, meta);
            planningPrimaryExecuted = planningSeparateModelChanged === true;
            changed = planningSeparateModelChanged || changed;
          } else {
            const planningPrimaryChanged = maybeInjectPlanningPrompt(ctx, meta) || false;
            planningPrimaryExecuted = planningPrimaryChanged === true;
            changed = planningPrimaryChanged || changed;
          }
          return {
            requestedAction:
              mode === "separate_model"
                ? PLANNING_DECISION.requestedAction.planningSeparateModel
                : PLANNING_DECISION.requestedAction.planningInject,
            executedPrimary: planningPrimaryExecuted,
            changed,
          };
        },
      });
      return { capability, point, status: "active", changed: lifecycle.execution.changed };
    }
    if (point === "after_llm_call") {
      const mode = resolveWorkflowMode(meta);
      const holder = ensureHarnessBucket(ctx);
      const lifecycle = await runWorkflowLifecycle(ctx, {
        domain: CAPABILITY_DOMAIN.PLANNING,
        point: "after_llm_call",
        mode,
        resolveDecision: () => ({
          chosenAction: PLANNING_DECISION.action.planningCapture,
          chosenReason: PLANNING_DECISION.reason.afterLlmCapture,
          chosenReasonLabel: resolvePlanningReasonLabel(
            holder?.state?.locale || LOCALE.ZH_CN,
            PLANNING_DECISION.reason.afterLlmCapture,
          ),
        }),
        execute: async () => {
          const captureChanged = (await maybeCapturePlanningResult(ctx, meta)) || false;
          return {
            requestedAction: PLANNING_DECISION.requestedAction.planningCapture,
            executedPrimary: captureChanged === true,
            changed: captureChanged === true,
          };
        },
      });
      return { capability, point, status: "active", changed: lifecycle.execution.changed };
    }
    return { capability, point, status: "active", changed: false };
  };
}
