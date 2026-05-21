/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { HARNESS_HOOK_POINTS } from "../core/constants.js";

export const HARNESS_FSM_STATES = Object.freeze({
  IDLE: "idle",
  PLANNING: "planning",
  PLANNED: "planned",
  HUMAN_APPROVAL: "human_approval",
  EXECUTING: "executing",
  VERIFYING: "verifying",
  DONE: "done",
  FAILED: "failed",
});

const HARNESS_FSM_STATE_SET = new Set(Object.values(HARNESS_FSM_STATES));

export const HARNESS_FSM_ALLOWED_TRANSITIONS = Object.freeze({
  [HARNESS_FSM_STATES.IDLE]: new Set([HARNESS_FSM_STATES.PLANNING, HARNESS_FSM_STATES.FAILED]),
  [HARNESS_FSM_STATES.PLANNING]: new Set([HARNESS_FSM_STATES.PLANNED, HARNESS_FSM_STATES.FAILED]),
  [HARNESS_FSM_STATES.PLANNED]: new Set([
    HARNESS_FSM_STATES.EXECUTING,
    HARNESS_FSM_STATES.HUMAN_APPROVAL,
    HARNESS_FSM_STATES.FAILED,
  ]),
  [HARNESS_FSM_STATES.HUMAN_APPROVAL]: new Set([
    HARNESS_FSM_STATES.EXECUTING,
    HARNESS_FSM_STATES.FAILED,
  ]),
  [HARNESS_FSM_STATES.EXECUTING]: new Set([HARNESS_FSM_STATES.VERIFYING, HARNESS_FSM_STATES.FAILED]),
  [HARNESS_FSM_STATES.VERIFYING]: new Set([HARNESS_FSM_STATES.DONE, HARNESS_FSM_STATES.FAILED]),
  [HARNESS_FSM_STATES.DONE]: new Set(),
  [HARNESS_FSM_STATES.FAILED]: new Set(),
});

export const HARNESS_FSM_TERMINAL_STATES = new Set([
  HARNESS_FSM_STATES.DONE,
  HARNESS_FSM_STATES.FAILED,
]);

export const HARNESS_FSM_EFFECTS = Object.freeze({
  AUDIT_RESUME: "audit_resume",
  AUDIT_TRANSITION: "audit_transition",
  AUDIT_REJECTED: "audit_rejected",
  CACHE_SET: "cache_set",
  CACHE_DELETE: "cache_delete",
});

export function normalizeFsmState(state = "") {
  const value = String(state || "").trim().toLowerCase();
  return HARNESS_FSM_STATE_SET.has(value) ? value : HARNESS_FSM_STATES.IDLE;
}

export function statusToFsmState(status = "") {
  const normalized = String(status || "").trim().toLowerCase();
  if (normalized === "success") return HARNESS_FSM_STATES.DONE;
  if (normalized === "error" || normalized === "abort") return HARNESS_FSM_STATES.FAILED;
  return HARNESS_FSM_STATES.IDLE;
}

export function isAllowedFsmTransition(from, to) {
  if (from === to) return true;
  return HARNESS_FSM_ALLOWED_TRANSITIONS[from]?.has(to) === true;
}

function resolveChecklistLength(ctx = {}) {
  return Array.isArray(ctx?.agentContext?.payload?.harness?.taskChecklist)
    ? ctx.agentContext.payload.harness.taskChecklist.length
    : 0;
}

const FSM_TARGET_RULES = Object.freeze([
  {
    points: new Set([
      HARNESS_HOOK_POINTS.ON_ERROR,
      HARNESS_HOOK_POINTS.ON_ABORT,
      HARNESS_HOOK_POINTS.CONTEXT_BUILD_ERROR,
      HARNESS_HOOK_POINTS.LLM_CALL_ERROR,
      HARNESS_HOOK_POINTS.TOOL_CALL_ERROR,
    ]),
    resolve: () => HARNESS_FSM_STATES.FAILED,
  },
  {
    points: new Set([HARNESS_HOOK_POINTS.AFTER_TURN]),
    resolve: () => HARNESS_FSM_STATES.DONE,
  },
  {
    points: new Set([HARNESS_HOOK_POINTS.BEFORE_FINAL_OUTPUT]),
    resolve: () => HARNESS_FSM_STATES.VERIFYING,
  },
  {
    points: new Set([HARNESS_HOOK_POINTS.BEFORE_TOOL_CALLS, HARNESS_HOOK_POINTS.BEFORE_TOOL_CALL]),
    resolve: () => HARNESS_FSM_STATES.EXECUTING,
  },
  {
    points: new Set([HARNESS_HOOK_POINTS.BEFORE_STATE_COMMIT, HARNESS_HOOK_POINTS.AFTER_STATE_COMMIT]),
    resolve: ({ ctx = {} }) => {
      const commitHint = String(ctx?.commitType || "").toLowerCase();
      return commitHint.includes("approval") ? HARNESS_FSM_STATES.HUMAN_APPROVAL : null;
    },
  },
  {
    points: new Set([HARNESS_HOOK_POINTS.AFTER_LLM_CALL]),
    resolve: ({ ctx = {}, currentState = HARNESS_FSM_STATES.IDLE }) => {
      if (currentState !== HARNESS_FSM_STATES.IDLE && currentState !== HARNESS_FSM_STATES.PLANNING) {
        return null;
      }
      return resolveChecklistLength(ctx) > 0 ? HARNESS_FSM_STATES.PLANNED : HARNESS_FSM_STATES.PLANNING;
    },
  },
  {
    points: new Set([
      HARNESS_HOOK_POINTS.BEFORE_CONTEXT_BUILD,
      HARNESS_HOOK_POINTS.AFTER_CONTEXT_BUILD,
      HARNESS_HOOK_POINTS.BEFORE_TURN,
      HARNESS_HOOK_POINTS.BEFORE_LLM_CALL,
    ]),
    resolve: ({ currentState = HARNESS_FSM_STATES.IDLE }) =>
      currentState === HARNESS_FSM_STATES.IDLE ? HARNESS_FSM_STATES.PLANNING : null,
  },
]);

export function inferFsmTarget(point, ctx = {}, currentState = HARNESS_FSM_STATES.IDLE) {
  for (const rule of FSM_TARGET_RULES) {
    if (!rule.points.has(point)) continue;
    return rule.resolve({ point, ctx, currentState }) ?? null;
  }
  return null;
}

export function buildFsmTransitionPlan(point, ctx = {}, currentState, resumed = false, runId = "") {
  const actions = [];
  if (resumed) {
    actions.push({
      type: HARNESS_FSM_EFFECTS.AUDIT_RESUME,
      payload: {
        point,
        accepted: true,
        from: currentState,
        to: currentState,
        reason: "resume_from_checkpoint",
      },
    });
  }

  const target = inferFsmTarget(point, ctx, currentState);
  if (!target) {
    return {
      state: currentState,
      changed: false,
      rejected: false,
      resumed,
      attempted: null,
      actions,
    };
  }

  if (!isAllowedFsmTransition(currentState, target)) {
    actions.push({
      type: HARNESS_FSM_EFFECTS.AUDIT_REJECTED,
      payload: {
        point,
        accepted: false,
        from: currentState,
        to: target,
        reason: "illegal_transition",
      },
    });
    return {
      state: currentState,
      changed: false,
      rejected: true,
      resumed,
      attempted: target,
      actions,
    };
  }

  if (currentState !== target) {
    actions.push({
      type: HARNESS_FSM_EFFECTS.AUDIT_TRANSITION,
      payload: {
        point,
        accepted: true,
        from: currentState,
        to: target,
        reason: "accepted",
      },
    });
    if (HARNESS_FSM_TERMINAL_STATES.has(target)) {
      actions.push({ type: HARNESS_FSM_EFFECTS.CACHE_DELETE, payload: { runId } });
    } else {
      actions.push({ type: HARNESS_FSM_EFFECTS.CACHE_SET, payload: { runId, state: target } });
    }
  }

  return {
    state: target,
    changed: currentState !== target,
    rejected: false,
    resumed,
    attempted: null,
    actions,
  };
}
