/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

import { WORKFLOW_RUNTIME_FAMILY } from "@noobot/event-protocol/workflow-runtime-event";

function resolveWorkflowCommitScope({ ctx, runtime, payload }) {
  return {
    userId: String(runtime?.userId || ctx?.userId || "").trim(),
    sessionId: String(ctx?.sessionId || "").trim(),
    turnScopeId: String(
      payload?.turnScopeId || ctx?.turnScopeId || runtime?.runConfig?.turnScopeId || "",
    ).trim(),
  };
}

function resolveWorkflowPersistenceScope(runtime) {
  return runtime?.systemRuntime?.persistenceScope || null;
}

function projectWorkflowEventIdentity({
  eventType,
  messageId,
  executionId,
  turnScopeId,
  payload,
  ctx,
}) {
  return {
    eventType: String(eventType || "").trim(),
    turnScopeId,
    messageId: String(messageId || payload?.messageId || "").trim(),
    executionId: String(
      executionId || payload?.nodeExecutionId || ctx?.workflowExecutionId || "",
    ).trim(),
  };
}

function projectWorkflowEventOrdering({ orderingDomain, orderingScopeId, revision, payload }) {
  return {
    domain: String(orderingDomain || "").trim(),
    scopeId: String(orderingScopeId || payload?.workflowRunId || "").trim(),
    revision: Number(revision),
  };
}

function projectWorkflowEventCausality({ payload, runtime }) {
  return {
    commandId: String(payload?.commandId || runtime?.runConfig?.commandId || "").trim(),
    correlationId: String(payload?.workflowRunId || "").trim(),
  };
}

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

function requireCommittedWorkflowEnvelope(committed) {
  if (!committed?.committed || !committed?.envelope) {
    throw new Error(`workflow authority event commit failed: ${committed?.reason || "unknown"}`);
  }
  return committed.envelope;
}

async function dispatchWorkflowAuthorityEvent({ ctx, envelope, persistenceScope }) {
  if (typeof ctx?.eventListener?.onEvent !== "function") {
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
  payload = {},
  orderingDomain = "",
  orderingScopeId = "",
  revision = 1,
  messageId = "",
  executionId = "",
} = {}) {
  const runtime = resolveWorkflowCommitRuntime(ctx);
  const sessionManager = requireWorkflowCommitCapability(runtime);
  const { userId, sessionId, turnScopeId } = resolveWorkflowCommitScope({ ctx, runtime, payload });
  const persistenceScope = resolveWorkflowPersistenceScope(runtime);
  const committed = await sessionManager.commitAuthorityEvent({
    userId,
    sessionId,
    family: WORKFLOW_RUNTIME_FAMILY,
    identity: projectWorkflowEventIdentity({
      eventType,
      messageId,
      executionId,
      turnScopeId,
      payload,
      ctx,
    }),
    causality: projectWorkflowEventCausality({ payload, runtime }),
    ordering: projectWorkflowEventOrdering({
      orderingDomain,
      orderingScopeId,
      revision,
      payload,
    }),
    producer: { type: "plugin", id: "workflow" },
    payload,
    persistenceScope,
  });
  const envelope = requireCommittedWorkflowEnvelope(committed);
  await dispatchWorkflowAuthorityEvent({ ctx, envelope, persistenceScope });
  return envelope;
}
