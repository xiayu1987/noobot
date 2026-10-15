/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

import { WORKFLOW_RUNTIME_FAMILY } from "@noobot/event-protocol/workflow-runtime-event";
import { PLUGIN_ID } from "../constants.js";
import { text } from "@noobot/shared/value";

function resolveWorkflowCommitScope({ ctx, runtime, payload }) {
  return {
    userId: text(runtime?.userId || ctx?.userId),
    sessionId: text(ctx?.sessionId),
    turnScopeId: text(payload?.turnScopeId || ctx?.turnScopeId || runtime?.runConfig?.turnScopeId),
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
    eventType: text(eventType),
    turnScopeId,
    messageId: text(messageId || payload?.messageId),
    executionId: text(executionId || payload?.nodeExecutionId || ctx?.workflowExecutionId),
  };
}

function projectWorkflowEventOrdering({ orderingDomain, orderingScopeId, revision, payload }) {
  return {
    domain: text(orderingDomain),
    scopeId: text(orderingScopeId || payload?.workflowRunId),
    revision: Number(revision),
  };
}

function projectWorkflowEventCausality({ payload, runtime }) {
  return {
    commandId: text(payload?.commandId || runtime?.runConfig?.commandId),
    correlationId: text(payload?.workflowRunId),
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
    producer: { type: "plugin", id: PLUGIN_ID },
    payload,
    persistenceScope,
  });
  const envelope = requireCommittedWorkflowEnvelope(committed);
  await dispatchWorkflowAuthorityEvent({ ctx, envelope, persistenceScope });
  return envelope;
}
