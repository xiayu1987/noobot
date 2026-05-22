/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { nowIso } from "../data/record-builders.js";
import { appendJsonlBuffered } from "../store/store.js";
import { HARNESS_FLUSH_REASONS } from "../core/constants.js";
import { HARNESS_FSM_EFFECTS } from "./transitions.js";

export async function appendFsmAudit(paths, ctx = {}, payload = {}, options = {}) {
  if (!paths?.stateCommits || !payload?.type) return;
  const flushReason =
    payload.accepted === false || String(payload.type).includes("rejected")
      ? HARNESS_FLUSH_REASONS.ERROR
      : HARNESS_FLUSH_REASONS.NONE;
  await appendJsonlBuffered(
    paths.stateCommits,
    {
      timestamp: nowIso(),
      runId: paths.runId,
      point: payload.point,
      type: payload.type,
      accepted: payload.accepted === true,
      from: payload.from,
      to: payload.to,
      reason: payload.reason,
      dialogProcessId: ctx.dialogProcessId || ctx?.agentContext?.execution?.dialogProcessId || undefined,
      sessionId: ctx.sessionId || undefined,
      userId: ctx.userId || undefined,
    },
    options.jsonlFlushStrategy || options.jsonlBatchSize,
    options.jsonlFlushIntervalMs,
    { reason: flushReason },
  );
}

export async function applyFsmTransitionEffects(paths, ctx = {}, options = {}, plan = {}, cacheApi = {}) {
  const actions = Array.isArray(plan.actions) ? plan.actions : [];
  for (const action of actions) {
    const payload = action?.payload || {};
    if (
      action.type === HARNESS_FSM_EFFECTS.AUDIT_RESUME ||
      action.type === HARNESS_FSM_EFFECTS.AUDIT_TRANSITION ||
      action.type === HARNESS_FSM_EFFECTS.AUDIT_REJECTED
    ) {
      await appendFsmAudit(
        paths,
        ctx,
        {
          point: payload.point,
          type:
            action.type === HARNESS_FSM_EFFECTS.AUDIT_RESUME
              ? "fsm_resume"
              : action.type === HARNESS_FSM_EFFECTS.AUDIT_REJECTED
                ? "fsm_transition_rejected"
                : "fsm_transition",
          accepted: payload.accepted,
          from: payload.from,
          to: payload.to,
          reason: payload.reason,
        },
        options,
      );
      continue;
    }
    if (action.type === HARNESS_FSM_EFFECTS.CACHE_SET) {
      if (payload.runId) cacheApi?.set?.(payload.runId, payload.state);
      continue;
    }
    if (action.type === HARNESS_FSM_EFFECTS.CACHE_DELETE) {
      if (payload.runId) cacheApi?.delete?.(payload.runId);
    }
  }
}
