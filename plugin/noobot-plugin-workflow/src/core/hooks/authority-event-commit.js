/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

import { requireCommittedAuthorityEvent } from "@noobot/event-protocol/outbox";
import { WORKFLOW_RUNTIME_FAMILY } from "@noobot/event-protocol/workflow-runtime-event";
import { PLUGIN_ID } from "../constants.js";
import { isCanonicalText, isFunction } from "@noobot/shared/value";

function resolveWorkflowCommitRuntime(ctx) {
  return ctx?.agentContext?.bindings?.runtime;
}

function requireWorkflowCommitCapability(runtime) {
  const sessionManager = runtime?.sessionManager;
  if (!sessionManager?.commitAuthorityEvent) {
    throw new Error("workflow authority event commit capability is required");
  }
  return sessionManager;
}

async function dispatchWorkflowAuthorityEvent({ ctx, envelope, persistenceScope }) {
  if (!isFunction(ctx?.eventListener?.onEvent)) {
    throw new Error("workflow authority event dispatcher is required");
  }
  await ctx.eventListener.onEvent({
    event: "authority_event_committed",
    data: { envelope, persistenceScope },
  });
}

export async function commitWorkflowRuntimeEvent({
  ctx = {},
  eventType = "",
  commandId = "",
  payload = {},
  orderingDomain = "",
  orderingScopeId = "",
  revision = 1,
  executionId = "",
} = {}) {
  const runtime = resolveWorkflowCommitRuntime(ctx);
  const sessionManager = requireWorkflowCommitCapability(runtime);
  if (!isCanonicalText(commandId)) {
    throw new TypeError("workflow authority event commandId is required");
  }
  const persistenceScope = runtime.systemRuntime.persistenceScope;
  const committed = await sessionManager.commitAuthorityEvent({
    userId: ctx.userId,
    sessionId: ctx.sessionId,
    family: WORKFLOW_RUNTIME_FAMILY,
    identity: { eventType, turnScopeId: payload.turnScopeId, executionId },
    causality: { commandId, correlationId: payload.workflowRunId },
    ordering: { domain: orderingDomain, scopeId: orderingScopeId, revision },
    producer: { type: "plugin", id: PLUGIN_ID },
    payload,
    persistenceScope,
  });
  const envelope = requireCommittedAuthorityEvent(committed);
  await dispatchWorkflowAuthorityEvent({ ctx, envelope, persistenceScope });
  return envelope;
}
