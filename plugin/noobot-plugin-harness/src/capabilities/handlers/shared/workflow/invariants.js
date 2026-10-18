/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { WORKFLOW_PARAMS } from "../../../../core/workflow-params.js";
import { appendCapabilityLog } from "../attachment-log-utils.js";
import { text } from "@noobot/shared/value";
import { readHarnessBucket } from "../bucket-utils.js";

const SHARED_EVENTS = WORKFLOW_PARAMS.logging.events.shared;

function ensureObject(source = {}) {
  return source && typeof source === "object" ? source : {};
}

export function enforceWorkflowInvariants(ctx = {}, { domain = "" } = {}) {
  const harness = readHarnessBucket(ctx);
  if (!harness) return false;
  const state = ensureObject(harness.state);
  harness.state = state;
  state.pending = ensureObject(state.pending);
  state.flags = ensureObject(state.flags);
  let changed = false;
  const violations = [];

  if (state.pending.planRevision !== true && state.pending.planRevisionContext) {
    state.pending.planRevisionContext = null;
    changed = true;
    violations.push("pending.planRevisionContext_cleared_without_pending");
  }

  if (state.pending.planRefinement !== true && state.pending.planRefinementContext) {
    state.pending.planRefinementContext = null;
    changed = true;
    violations.push("pending.planRefinementContext_cleared_without_pending");
  }

  if (!changed) return false;
  appendCapabilityLog(ctx, {
    domain: text(domain) || "guidance",
    event: SHARED_EVENTS.workflowInvariantViolation,
    detail: { violations },
  });
  return true;
}
