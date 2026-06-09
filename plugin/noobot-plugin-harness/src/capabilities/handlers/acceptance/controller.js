/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import {
  ACCEPTANCE_MODE,
  BLOCKED_AGENT_TOOL_NAMES,
  CAPABILITY_DOMAIN,
  LLM_SUMMARY_OVERFLOW_POLICY,
  TASK_ACCEPTANCE_TOOL_NAME,
  disableBlockedCalls,
  disableBlockedToolsInRegistry,
  ensureHarnessBucket,
  translateI18nText,
} from "./deps.js";
import { WORKFLOW_PARAMS } from "../../../core/workflow-params.js";
import {
  ensurePhaseAcceptanceBeforeFinalAcceptance,
  maybeCaptureAcceptanceSemanticValidationByInject,
  maybeInjectAcceptanceSemanticValidationPrompt,
  maybeCapturePhaseAcceptanceByInject,
  maybeInjectPhaseAcceptancePrompt,
  runPhaseAcceptanceBySeparateModel,
} from "./validation-runner.js";
import {
  maybeAppendAcceptanceReportAtFinalOutput,
  maybeAttachChecklistArtifactsAtFinalOutput,
  maybeForceAcceptanceAtFinalOutput,
  maybeRefreshAcceptanceReportBeforeFinalOutput,
} from "./output-finalizer.js";
import { ensureTaskAcceptanceTool } from "./tool-injector.js";
import { shouldUseSeparateModel } from "../shared/model/utils.js";
import {
  resolveWorkflowMode,
  runWorkflowLifecycle,
} from "../shared/workflow/pattern.js";
import { ACCEPTANCE_PHASE_BLOCKER_KEYS, hasAcceptancePhaseBlockers } from "../shared/workflow/policy.js";
import { enforceWorkflowInvariants } from "../shared/workflow/invariants.js";
import { buildHarnessInjectedMessage } from "../shared/message/injected-message-utils.js";

const ACCEPTANCE_DECISION = WORKFLOW_PARAMS.acceptance.decisions;
const ACCEPTANCE_REQUESTED_ACTION = ACCEPTANCE_DECISION.requestedAction;
const ACCEPTANCE_REASON_LABEL_KEY = Object.freeze({
  [ACCEPTANCE_DECISION.reason.overflowForceAcceptance]: "acceptanceReasonOverflowForceAcceptance",
  [ACCEPTANCE_DECISION.reason.phaseAcceptanceBlocked]: "acceptanceReasonPhaseAcceptanceBlocked",
  [ACCEPTANCE_DECISION.reason.phaseAcceptancePending]: "acceptanceReasonPhaseAcceptancePending",
  [ACCEPTANCE_DECISION.reason.acceptanceSemanticValidationPending]:
    "acceptanceReasonSemanticValidationPending",
  [ACCEPTANCE_DECISION.reason.toolGuard]: "acceptanceReasonToolGuard",
  [ACCEPTANCE_DECISION.reason.beforeTurnSetup]: "acceptanceReasonBeforeTurnSetup",
  [ACCEPTANCE_DECISION.reason.finalOutputOverflowFallback]:
    "acceptanceReasonFinalOutputOverflowFallback",
  [ACCEPTANCE_DECISION.reason.finalOutputAcceptanceFallback]:
    "acceptanceReasonFinalOutputAcceptanceFallback",
  [ACCEPTANCE_DECISION.reason.afterLlmCapture]: "acceptanceReasonAfterLlmCapture",
  [ACCEPTANCE_DECISION.reason.idle]: "acceptanceReasonIdle",
});
const ACCEPTANCE_BLOCKED_REASON_LABEL_KEY = Object.freeze({
  phase_acceptance_blocked_by_higher_priority_pending:
    "acceptanceBlockedPhaseAcceptanceHigherPriority",
  acceptance_semantic_validation_deferred_by_primary_choice:
    "acceptanceBlockedSemanticValidationDeferred",
});

function resolveAcceptanceLocale(state = {}) {
  return String(state?.locale || "").trim() || "zh-CN";
}

function resolveAcceptanceReasonLabel(locale = "zh-CN", reason = "") {
  const key = ACCEPTANCE_REASON_LABEL_KEY[String(reason || "").trim()];
  if (!key) return String(reason || "").trim();
  return translateI18nText(locale, key) || String(reason || "").trim();
}

function resolveAcceptanceBlockedReasonLabel(locale = "zh-CN", reason = "") {
  const key = ACCEPTANCE_BLOCKED_REASON_LABEL_KEY[String(reason || "").trim()];
  if (!key) return String(reason || "").trim();
  return translateI18nText(locale, key) || String(reason || "").trim();
}

function hasHigherPriorityPendingForPhaseAcceptance(state = {}) {
  return hasAcceptancePhaseBlockers(state);
}

function resolvePendingPlanUpdateSnapshot(state = {}) {
  const pending = state?.pending && typeof state.pending === "object" ? state.pending : {};
  if (pending.planRevision === true) {
    const context =
      pending.planRevisionContext && typeof pending.planRevisionContext === "object"
        ? pending.planRevisionContext
        : {};
    return {
      active: true,
      stage: "revision",
      context: {
        summaryText: String(context.summaryText || "").trim(),
        targetMainStepIndexes: Array.isArray(context.targetMainStepIndexes)
          ? context.targetMainStepIndexes
          : [],
      },
    };
  }
  if (pending.planRefinement === true) {
    const context =
      pending.planRefinementContext && typeof pending.planRefinementContext === "object"
        ? pending.planRefinementContext
        : {};
    return {
      active: true,
      stage: "refinement",
      context: {
        summaryText: String(context.summaryText || "").trim(),
        targetMainStepIndexes: Array.isArray(context.targetMainStepIndexes)
          ? context.targetMainStepIndexes
          : [],
      },
    };
  }
  return { active: false, stage: "", context: {} };
}

function resolveAcceptanceDecision({
  point = "",
  holder = null,
  forceAcceptanceDueToOverflow = false,
} = {}) {
  const state = holder?.state || {};
  const pending = state?.pending && typeof state.pending === "object" ? state.pending : {};
  const candidateActions = [];
  const blockedActions = [];
  const blockedReasons = [];
  let category = ACCEPTANCE_DECISION.category.workflow;
  let chosenAction = ACCEPTANCE_DECISION.action.none;
  let chosenReason = ACCEPTANCE_DECISION.reason.idle;
  if (point === "before_llm_call") {
    if (forceAcceptanceDueToOverflow) {
      candidateActions.push(ACCEPTANCE_DECISION.action.forcedAcceptance);
      chosenAction = ACCEPTANCE_DECISION.action.forcedAcceptance;
      chosenReason = ACCEPTANCE_DECISION.reason.overflowForceAcceptance;
    } else {
      if (pending.phaseAcceptance === true) {
        candidateActions.push(ACCEPTANCE_DECISION.action.phaseAcceptance);
        if (hasHigherPriorityPendingForPhaseAcceptance(state)) {
          blockedActions.push(ACCEPTANCE_DECISION.action.phaseAcceptance);
          blockedReasons.push("phase_acceptance_blocked_by_higher_priority_pending");
          chosenAction = ACCEPTANCE_DECISION.action.none;
          chosenReason = ACCEPTANCE_DECISION.reason.phaseAcceptanceBlocked;
        } else {
          chosenAction = ACCEPTANCE_DECISION.action.phaseAcceptance;
          chosenReason = ACCEPTANCE_DECISION.reason.phaseAcceptancePending;
        }
      }
      if (pending.acceptanceSemanticValidation) {
        candidateActions.push(ACCEPTANCE_DECISION.action.acceptanceSemanticValidation);
        if (chosenAction === ACCEPTANCE_DECISION.action.none) {
          chosenAction = ACCEPTANCE_DECISION.action.acceptanceSemanticValidation;
          chosenReason = ACCEPTANCE_DECISION.reason.acceptanceSemanticValidationPending;
        } else {
          blockedActions.push(ACCEPTANCE_DECISION.action.acceptanceSemanticValidation);
          blockedReasons.push("acceptance_semantic_validation_deferred_by_primary_choice");
        }
      }
    }
  } else if (point === "before_tool_calls" || point === "before_tool_call") {
    category = ACCEPTANCE_DECISION.category.guard;
    if (forceAcceptanceDueToOverflow) {
      candidateActions.push(ACCEPTANCE_DECISION.action.forcedAcceptance);
      chosenAction = ACCEPTANCE_DECISION.action.forcedAcceptance;
      chosenReason = ACCEPTANCE_DECISION.reason.overflowForceAcceptance;
    } else {
      candidateActions.push(ACCEPTANCE_DECISION.action.acceptanceToolGuard);
      chosenAction = ACCEPTANCE_DECISION.action.acceptanceToolGuard;
      chosenReason = ACCEPTANCE_DECISION.reason.toolGuard;
    }
  } else if (point === "before_turn") {
    category = ACCEPTANCE_DECISION.category.guard;
    candidateActions.push(ACCEPTANCE_DECISION.action.acceptanceToolGuard);
    chosenAction = ACCEPTANCE_DECISION.action.acceptanceToolGuard;
    chosenReason = ACCEPTANCE_DECISION.reason.beforeTurnSetup;
  } else if (point === "before_final_output") {
    category = ACCEPTANCE_DECISION.category.guard;
    candidateActions.push(ACCEPTANCE_DECISION.action.finalOutputAcceptanceGuard);
    chosenAction = ACCEPTANCE_DECISION.action.finalOutputAcceptanceGuard;
    chosenReason = forceAcceptanceDueToOverflow
      ? ACCEPTANCE_DECISION.reason.finalOutputOverflowFallback
      : ACCEPTANCE_DECISION.reason.finalOutputAcceptanceFallback;
  } else if (point === "after_llm_call") {
    candidateActions.push(ACCEPTANCE_DECISION.action.acceptanceCapture);
    chosenAction = ACCEPTANCE_DECISION.action.acceptanceCapture;
    chosenReason = ACCEPTANCE_DECISION.reason.afterLlmCapture;
  }
  const planUpdateSnapshot = resolvePendingPlanUpdateSnapshot(state);
  const locale = resolveAcceptanceLocale(state);
  return {
    category,
    chosenAction,
    chosenReason,
    chosenReasonLabel: resolveAcceptanceReasonLabel(locale, chosenReason),
    candidateActions,
    deferredActions: candidateActions.filter((item) => item !== chosenAction),
    blockedActions,
    blockedReasons,
    blockedReasonLabels: blockedReasons.map((reason) =>
      resolveAcceptanceBlockedReasonLabel(locale, reason),
    ),
    pending: {
      summary: {
        active: pending.summary === true,
        reason: pending.summary === true
          ? (state?.flags?.summaryByCharsPrompted === true ? "summary_overflow" : "summary_turns")
          : "",
      },
      guidance: {
        active: Boolean(pending.guidance),
        payload: pending.guidance || null,
      },
      planUpdate: {
        active: planUpdateSnapshot.active === true,
        stage: planUpdateSnapshot.stage,
        context: planUpdateSnapshot.context,
      },
      phaseAcceptance: {
        active: pending.phaseAcceptance === true,
        blockedBy: hasHigherPriorityPendingForPhaseAcceptance(state)
          ? ACCEPTANCE_PHASE_BLOCKER_KEYS
          : [],
      },
      acceptanceSemanticValidation: {
        active: Boolean(pending.acceptanceSemanticValidation),
      },
      flags: {
        planningCaptured: state?.flags?.planningCaptured === true,
        summaryByCharsPrompted: state?.flags?.summaryByCharsPrompted === true,
        overflowForceAcceptancePending: state?.flags?.overflowForceAcceptancePending === true,
      },
    },
  };
}

function resolveAcceptanceRequestedAction({
  point = "",
  mode = "",
  chosenAction = ACCEPTANCE_DECISION.action.none,
  chosenReason = ACCEPTANCE_DECISION.reason.idle,
  forceAcceptanceDueToOverflow = false,
} = {}) {
  const normalizedMode = String(mode || "").trim() === "separate_model" ? "separate_model" : "inject";
  const hook = String(point || "").trim();
  if (hook === "before_turn") {
    return ACCEPTANCE_REQUESTED_ACTION.acceptanceToolGuardBeforeTurn;
  }
  if (hook === "before_tool_calls") {
    return forceAcceptanceDueToOverflow
      ? ACCEPTANCE_REQUESTED_ACTION.forcedAcceptanceBeforeToolCallsRewrite
      : ACCEPTANCE_REQUESTED_ACTION.acceptanceToolGuardBeforeToolCalls;
  }
  if (hook === "before_tool_call") {
    return forceAcceptanceDueToOverflow
      ? ACCEPTANCE_REQUESTED_ACTION.forcedAcceptanceBeforeToolCallRewrite
      : ACCEPTANCE_REQUESTED_ACTION.acceptanceToolGuardBeforeToolCall;
  }
  if (hook === "before_llm_call") {
    if (forceAcceptanceDueToOverflow) {
      return ACCEPTANCE_REQUESTED_ACTION.forcedAcceptanceBeforeLlmInject;
    }
    if (chosenAction === ACCEPTANCE_DECISION.action.phaseAcceptance) {
      return normalizedMode === "separate_model"
        ? ACCEPTANCE_REQUESTED_ACTION.phaseAcceptanceSeparateModel
        : ACCEPTANCE_REQUESTED_ACTION.phaseAcceptanceInject;
    }
    if (chosenAction === ACCEPTANCE_DECISION.action.acceptanceSemanticValidation) {
      return ACCEPTANCE_REQUESTED_ACTION.acceptanceSemanticValidationInject;
    }
    return ACCEPTANCE_REQUESTED_ACTION.none;
  }
  if (hook === "before_final_output") {
    return chosenReason === ACCEPTANCE_DECISION.reason.finalOutputOverflowFallback
      ? ACCEPTANCE_REQUESTED_ACTION.finalOutputOverflowGuard
      : ACCEPTANCE_REQUESTED_ACTION.finalOutputAcceptanceGuard;
  }
  if (hook === "after_llm_call") {
    return ACCEPTANCE_REQUESTED_ACTION.acceptanceCaptureInject;
  }
  return ACCEPTANCE_REQUESTED_ACTION.none;
}

async function handleAcceptanceLifecycle(point = "", ctx = {}, meta = {}) {
  const invariantChanged = enforceWorkflowInvariants(ctx, { domain: CAPABILITY_DOMAIN.ACCEPTANCE }) === true;
  const holder = ensureHarnessBucket(ctx);
  const mode = resolveWorkflowMode(meta);
  const forceAcceptanceDueToOverflow =
    LLM_SUMMARY_OVERFLOW_POLICY.FORCE_ACCEPTANCE_WHEN_STILL_OVERFLOW === true &&
    holder?.state?.flags?.overflowForceAcceptancePending === true;
  const decision = resolveAcceptanceDecision({
    point,
    holder,
    forceAcceptanceDueToOverflow,
  });
  const requestedAction = resolveAcceptanceRequestedAction({
    point,
    mode,
    chosenAction: decision.chosenAction,
    chosenReason: decision.chosenReason,
    forceAcceptanceDueToOverflow,
  });
  const lifecycle = await runWorkflowLifecycle(ctx, {
    domain: CAPABILITY_DOMAIN.ACCEPTANCE,
    point,
    mode,
    resolveDecision: () => ({
      category: decision.category,
      chosenAction: decision.chosenAction,
      chosenReason: decision.chosenReason,
      chosenReasonLabel: decision.chosenReasonLabel,
      candidateActions: decision.candidateActions,
      deferredActions: decision.deferredActions,
      blockedActions: decision.blockedActions,
      blockedReasons: decision.blockedReasons,
      blockedReasonLabels: decision.blockedReasonLabels,
      pending: decision.pending,
    }),
    execute: async () => {
      let changed = invariantChanged;
      let executedPrimary = false;
      let executedFollowup = false;
      if (point === "before_turn" && decision.chosenAction === ACCEPTANCE_DECISION.action.acceptanceToolGuard) {
        if (holder?.state?.flags) {
          holder.state.flags.acceptanceReportAppendedToFinalOutput = false;
          holder.state.flags.phaseAcceptanceTriggeredThisTurn = false;
        }
        const step1 = disableBlockedToolsInRegistry(ctx);
        const step2 = ensureTaskAcceptanceTool(ctx, meta);
        changed = step1 || step2 || changed;
        executedPrimary = step1 === true || step2 === true;
      }
      if (point === "before_tool_calls" && decision.chosenAction === ACCEPTANCE_DECISION.action.forcedAcceptance) {
        if (Array.isArray(ctx?.calls) && ctx.calls.length) {
          const firstCall = ctx.calls[0] || {};
          firstCall.name = TASK_ACCEPTANCE_TOOL_NAME;
          firstCall.args = { mode: ACCEPTANCE_MODE.FORCED };
          ctx.calls.length = 1;
          ctx.calls[0] = firstCall;
          changed = true;
          executedPrimary = true;
        }
        const step = ensureTaskAcceptanceTool(ctx, meta);
        changed = step || changed;
        executedFollowup = step === true || executedFollowup;
      } else if (point === "before_tool_calls" && decision.chosenAction === ACCEPTANCE_DECISION.action.acceptanceToolGuard) {
        const step1 = disableBlockedCalls(ctx?.calls || []);
        const step2 = ensureTaskAcceptanceTool(ctx, meta);
        changed = step1 || step2 || changed;
        executedPrimary = step1 === true || step2 === true;
      }
      if (point === "before_tool_call" && decision.chosenAction === ACCEPTANCE_DECISION.action.forcedAcceptance) {
        ctx.call.name = TASK_ACCEPTANCE_TOOL_NAME;
        ctx.call.args = { mode: ACCEPTANCE_MODE.FORCED };
        changed = true;
        executedPrimary = true;
      } else if (
        point === "before_tool_call" &&
        decision.chosenAction === ACCEPTANCE_DECISION.action.acceptanceToolGuard &&
        BLOCKED_AGENT_TOOL_NAMES.has(String(ctx?.call?.name || "").trim())
      ) {
        ctx.call.name = TASK_ACCEPTANCE_TOOL_NAME;
        ctx.call.args = { mode: ACCEPTANCE_MODE.ACTIVE };
        changed = true;
        executedPrimary = true;
      }
      if (point === "before_llm_call" && decision.chosenAction === ACCEPTANCE_DECISION.action.forcedAcceptance) {
        if (Array.isArray(ctx?.messages)) {
          const overflowPromptTemplate =
            WORKFLOW_PARAMS.acceptance.guards.overflowForcedAcceptanceSystemPrompt;
          const overflowPrompt = String(overflowPromptTemplate || "")
            .replaceAll("{tool}", TASK_ACCEPTANCE_TOOL_NAME);
          ctx.messages.unshift(
            buildHarnessInjectedMessage(overflowPrompt, { role: "system" }),
          );
          changed = true;
          executedPrimary = true;
        }
      }
      if (point === "before_final_output" && decision.chosenAction === ACCEPTANCE_DECISION.action.finalOutputAcceptanceGuard) {
        const step1 = (await ensurePhaseAcceptanceBeforeFinalAcceptance(ctx, meta)) || false;
        const step2 = (await maybeRefreshAcceptanceReportBeforeFinalOutput(ctx, meta, {
          phaseAcceptanceChanged: step1 === true,
        })) || false;
        const step3 = (await maybeForceAcceptanceAtFinalOutput(ctx, meta)) || false;
        const step4 = (await maybeAttachChecklistArtifactsAtFinalOutput(ctx)) || false;
        const step5 = maybeAppendAcceptanceReportAtFinalOutput(ctx) || false;
        changed = step1 || step2 || step3 || step4 || step5 || changed;
        executedPrimary = step1 === true || step2 === true || step3 === true;
        executedFollowup = step4 === true || step5 === true;
        if (holder?.state?.flags?.overflowForceAcceptancePending === true) {
          holder.state.flags.overflowForceAcceptancePending = false;
          changed = true;
        }
      }
      if (point === "before_llm_call" && decision.chosenAction === ACCEPTANCE_DECISION.action.phaseAcceptance) {
        if (shouldUseSeparateModel(meta)) {
          const result = (await runPhaseAcceptanceBySeparateModel(ctx, meta)) || false;
          changed = result || changed;
          executedPrimary = result === true || executedPrimary;
        } else {
          const result = maybeInjectPhaseAcceptancePrompt(ctx) || false;
          changed = result || changed;
          executedPrimary = result === true || executedPrimary;
        }
      } else if (
        point === "before_llm_call" &&
        decision.chosenAction === ACCEPTANCE_DECISION.action.acceptanceSemanticValidation
      ) {
        const result = maybeInjectAcceptanceSemanticValidationPrompt(ctx) || false;
        changed = result || changed;
        executedPrimary = result === true || executedPrimary;
      }
      if (point === "after_llm_call" && decision.chosenAction === ACCEPTANCE_DECISION.action.acceptanceCapture) {
        const step1 = (await maybeCapturePhaseAcceptanceByInject(ctx)) || false;
        const step2 = (await maybeCaptureAcceptanceSemanticValidationByInject(ctx)) || false;
        changed = step1 || step2 || changed;
        executedPrimary = step1 === true;
        executedFollowup = step2 === true;
      }
      return {
        requestedAction,
        executedPrimary,
        executedFollowup,
        changed,
      };
    },
  });
  return lifecycle.execution.changed;
}

export function createAcceptanceHandler({ shouldProcessPrimaryToolHooks }) {
  return async ({ capability, point = "", ctx = {}, meta = {} } = {}) => {
    if (
      ["before_tool_calls", "before_tool_call", "after_tool_call", "tool_call_error"].includes(
        String(point || "").trim(),
      ) &&
      !shouldProcessPrimaryToolHooks(ctx)
    ) {
      return { capability, point, status: "active", changed: false };
    }
    const changed = await handleAcceptanceLifecycle(point, ctx, meta);
    return { capability, point, status: "active", changed };
  };
}

export { ensureTaskAcceptanceTool };
