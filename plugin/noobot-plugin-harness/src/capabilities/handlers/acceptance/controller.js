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
import { maybeAttachChecklistArtifactsAtFinalOutput, maybeForceAcceptanceAtFinalOutput } from "./output-finalizer.js";
import { ensureTaskAcceptanceTool } from "./tool-injector.js";
import { shouldUseSeparateModel } from "../shared/model/utils.js";
import {
  resolveWorkflowMode,
  runWorkflowLifecycle,
} from "../shared/workflow/pattern.js";
import { ACCEPTANCE_PHASE_BLOCKER_KEYS, hasAcceptancePhaseBlockers } from "../shared/workflow/policy.js";
import { enforceWorkflowInvariants } from "../shared/workflow/invariants.js";

const ACCEPTANCE_DECISION = WORKFLOW_PARAMS.acceptance.decisions;
const ACCEPTANCE_REQUESTED_ACTION = ACCEPTANCE_DECISION.requestedAction;

function hasHigherPriorityPendingForPhaseAcceptance(state = {}) {
  return hasAcceptancePhaseBlockers(state);
}

function resolveAcceptanceDecision({
  point = "",
  holder = null,
  forceAcceptanceDueToOverflow = false,
} = {}) {
  const state = holder?.state || {};
  const pending = state?.pending && typeof state.pending === "object" ? state.pending : {};
  const blockedActions = [];
  let category = ACCEPTANCE_DECISION.category.workflow;
  let chosenAction = ACCEPTANCE_DECISION.action.none;
  let chosenReason = ACCEPTANCE_DECISION.reason.idle;
  if (point === "before_llm_call") {
    if (forceAcceptanceDueToOverflow) {
      chosenAction = ACCEPTANCE_DECISION.action.forcedAcceptance;
      chosenReason = ACCEPTANCE_DECISION.reason.overflowForceAcceptance;
    } else if (pending.phaseAcceptance === true) {
      if (hasHigherPriorityPendingForPhaseAcceptance(state)) {
        blockedActions.push(ACCEPTANCE_DECISION.action.phaseAcceptance);
        chosenAction = ACCEPTANCE_DECISION.action.none;
        chosenReason = ACCEPTANCE_DECISION.reason.phaseAcceptanceBlocked;
      } else {
        chosenAction = ACCEPTANCE_DECISION.action.phaseAcceptance;
        chosenReason = ACCEPTANCE_DECISION.reason.phaseAcceptancePending;
      }
    }
    if (pending.acceptanceSemanticValidation) {
      if (chosenAction === ACCEPTANCE_DECISION.action.none) {
        chosenAction = ACCEPTANCE_DECISION.action.acceptanceSemanticValidation;
        chosenReason = ACCEPTANCE_DECISION.reason.acceptanceSemanticValidationPending;
      } else {
        blockedActions.push(ACCEPTANCE_DECISION.action.acceptanceSemanticValidation);
      }
    }
  } else if (point === "before_tool_calls" || point === "before_tool_call") {
    category = ACCEPTANCE_DECISION.category.guard;
    if (forceAcceptanceDueToOverflow) {
      chosenAction = ACCEPTANCE_DECISION.action.forcedAcceptance;
      chosenReason = ACCEPTANCE_DECISION.reason.overflowForceAcceptance;
    } else {
      chosenAction = ACCEPTANCE_DECISION.action.acceptanceToolGuard;
      chosenReason = ACCEPTANCE_DECISION.reason.toolGuard;
    }
  } else if (point === "before_turn") {
    category = ACCEPTANCE_DECISION.category.guard;
    chosenAction = ACCEPTANCE_DECISION.action.acceptanceToolGuard;
    chosenReason = ACCEPTANCE_DECISION.reason.beforeTurnSetup;
  } else if (point === "before_final_output") {
    category = ACCEPTANCE_DECISION.category.guard;
    chosenAction = ACCEPTANCE_DECISION.action.finalOutputAcceptanceGuard;
    chosenReason = forceAcceptanceDueToOverflow
      ? ACCEPTANCE_DECISION.reason.finalOutputOverflowFallback
      : ACCEPTANCE_DECISION.reason.finalOutputAcceptanceFallback;
  } else if (point === "after_llm_call") {
    chosenAction = ACCEPTANCE_DECISION.action.acceptanceCapture;
    chosenReason = ACCEPTANCE_DECISION.reason.afterLlmCapture;
  }
  return {
    category,
    chosenAction,
    chosenReason,
    blockedActions,
    pending: {
      summary: pending.summary === true,
      guidance: pending.guidance || null,
      planUpdate: pending.planUpdate === true,
      phaseAcceptance: pending.phaseAcceptance === true,
      acceptanceSemanticValidation: Boolean(pending.acceptanceSemanticValidation),
      planningCaptured: state?.flags?.planningCaptured === true,
      overflowForceAcceptancePending: state?.flags?.overflowForceAcceptancePending === true,
      acceptancePhaseBlockerKeys: ACCEPTANCE_PHASE_BLOCKER_KEYS,
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
      blockedActions: decision.blockedActions,
      pending: decision.pending,
    }),
    execute: async () => {
      let changed = invariantChanged;
      let executedPrimary = false;
      let executedFollowup = false;
      if (point === "before_turn") {
        const step1 = disableBlockedToolsInRegistry(ctx);
        const step2 = ensureTaskAcceptanceTool(ctx, meta);
        changed = step1 || step2 || changed;
        executedPrimary = step1 === true || step2 === true;
      }
      if (point === "before_tool_calls") {
        if (forceAcceptanceDueToOverflow && Array.isArray(ctx?.calls) && ctx.calls.length) {
          const firstCall = ctx.calls[0] || {};
          firstCall.name = TASK_ACCEPTANCE_TOOL_NAME;
          firstCall.args = { mode: ACCEPTANCE_MODE.FORCED };
          ctx.calls.length = 1;
          ctx.calls[0] = firstCall;
          changed = true;
          executedPrimary = true;
        }
        const step1 = disableBlockedCalls(ctx?.calls || []);
        const step2 = ensureTaskAcceptanceTool(ctx, meta);
        changed = step1 || step2 || changed;
        executedPrimary = executedPrimary || step1 === true || step2 === true;
      }
      if (point === "before_tool_call" && BLOCKED_AGENT_TOOL_NAMES.has(String(ctx?.call?.name || "").trim())) {
        ctx.call.name = TASK_ACCEPTANCE_TOOL_NAME;
        ctx.call.args = { mode: ACCEPTANCE_MODE.ACTIVE };
        changed = true;
        executedPrimary = true;
      }
      if (point === "before_tool_call" && forceAcceptanceDueToOverflow) {
        ctx.call.name = TASK_ACCEPTANCE_TOOL_NAME;
        ctx.call.args = { mode: ACCEPTANCE_MODE.FORCED };
        changed = true;
        executedPrimary = true;
      }
      if (point === "before_llm_call" && forceAcceptanceDueToOverflow) {
        if (Array.isArray(ctx?.messages)) {
          const overflowPromptTemplate =
            WORKFLOW_PARAMS.acceptance.guards.overflowForcedAcceptanceSystemPrompt;
          const overflowPrompt = String(overflowPromptTemplate || "")
            .replaceAll("{tool}", TASK_ACCEPTANCE_TOOL_NAME);
          ctx.messages.unshift({
            role: "system",
            content: overflowPrompt,
          });
          changed = true;
          executedPrimary = true;
        }
      }
      if (point === "before_final_output") {
        const step1 = (await ensurePhaseAcceptanceBeforeFinalAcceptance(ctx, meta)) || false;
        const step2 = (await maybeForceAcceptanceAtFinalOutput(ctx, meta)) || false;
        const step3 = (await maybeAttachChecklistArtifactsAtFinalOutput(ctx)) || false;
        changed = step1 || step2 || step3 || changed;
        executedPrimary = step1 === true || step2 === true;
        executedFollowup = step3 === true;
        if (holder?.state?.flags?.overflowForceAcceptancePending === true) {
          holder.state.flags.overflowForceAcceptancePending = false;
          changed = true;
        }
      }
      if (point === "before_llm_call") {
        if (holder?.state?.pending?.phaseAcceptance === true && !hasHigherPriorityPendingForPhaseAcceptance(holder.state)) {
          if (shouldUseSeparateModel(meta)) {
            const result = (await runPhaseAcceptanceBySeparateModel(ctx, meta)) || false;
            changed = result || changed;
            executedPrimary = result === true || executedPrimary;
          } else {
            const result = maybeInjectPhaseAcceptancePrompt(ctx) || false;
            changed = result || changed;
            executedPrimary = result === true || executedPrimary;
          }
        }
        const followup = maybeInjectAcceptanceSemanticValidationPrompt(ctx) || false;
        changed = followup || changed;
        executedFollowup = followup === true || executedFollowup;
      }
      if (point === "after_llm_call") {
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
