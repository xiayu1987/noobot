/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

import {
  WORKFLOW_BOT_HOOK_POINTS,
  WORKFLOW_PHASE_STATUS,
  WORKFLOW_PHASES,
  WORKFLOW_RETRY,
  WORKFLOW_TRACE,
} from "../constants.js";
import { executeWorkflowText } from "../../workflow/adapter.js";
import {
  isWorkflowAbortError,
  throwIfWorkflowAborted,
} from "../hooks/runtime.js";
import { resolveWorkflowSourceText } from "../hooks/messages.js";
import { appendWorkflowTrace, createPhaseTracker } from "../hooks/phase.js";
import {
  appendWorkflowPlanningMessage,
  emitWorkflowRuntimeEvent,
  persistWorkflowPlanningDialog,
} from "../hooks/persistence.js";
import { buildWorkflowOrchestrationPayload } from "../orchestration-payload.js";
import { resolveSemanticText } from "./semantic-resolution.js";
import { runWorkflowExecution } from "./execution-runner.js";
import { enrichWorkflowPayload } from "./payload-enrichment.js";

function createWorkflowRetryMeta() {
  return {
    maxAttempts: WORKFLOW_RETRY.MAX_ATTEMPTS,
    attempts: WORKFLOW_RETRY.MAX_ATTEMPTS,
    history: [],
  };
}

function createPlanningExecutionStub() {
  return {
    started: false,
    instanceId: "",
    autoTransitions: 0,
    completed: false,
    pendingStepCount: 0,
    actionRecords: [],
    nodeAgentRuns: [],
  };
}

function attachPlanningDialog(payload = {}, ctx = {}, planningPersistResult = null) {
  payload.planningDialog = {
    dialogId: String(ctx?.dialogProcessId || "").trim(),
    sessionId: String(ctx?.sessionId || "").trim(),
    storagePath: String(planningPersistResult?.outputDir || "").trim(),
    storageFile: String(planningPersistResult?.outputFile || "").trim(),
  };
  return payload;
}

async function preparePlanningMessage({
  options = {},
  ctx = {},
  agentResult = {},
  sourceText = "",
  semanticText = "",
  semantic = null,
  semanticResolution = {},
  phaseTracker,
  retryMeta = {},
  planningPersistResult = null,
} = {}) {
  const planningWorkflowPayload = buildWorkflowOrchestrationPayload({
    ctx,
    options,
    sourceText,
    semanticText,
    semantic,
    execution: createPlanningExecutionStub(),
    semanticResolution,
    phaseTimeline: phaseTracker.list(),
    retryMeta,
  });
  attachPlanningDialog(planningWorkflowPayload, ctx, planningPersistResult);
  planningWorkflowPayload.nodeSessions = [];
  planningWorkflowPayload.attachmentMetas = [];
  await appendWorkflowPlanningMessage({
    options,
    agentResult,
    ctx,
    sourceText,
    semanticText,
    semanticResolution,
    workflowPayload: planningWorkflowPayload,
    attachmentMetas: [],
  });
  await emitWorkflowRuntimeEvent({
    options,
    ctx,
    event: "workflow_planning_message_prepared",
    data: {
      dialogId: String(ctx?.dialogProcessId || "").trim(),
    },
  });
}

async function handleWorkflowFailure({
  error,
  options = {},
  ctx = {},
  agentResult = {},
  sourceText = "",
  phaseTracker,
  retryMeta = {},
  beforeDispatchMode = false,
} = {}) {
  retryMeta.history.push({
    attempt: 1,
    status: WORKFLOW_PHASE_STATUS.FAILED,
    timestamp: new Date().toISOString(),
    message: String(error?.message || error || ""),
  });
  phaseTracker.end(WORKFLOW_PHASES.SEMANTIC_RESOLUTION, WORKFLOW_PHASE_STATUS.FAILED, {
    message: String(error?.message || error || ""),
  });
  phaseTracker.end(WORKFLOW_PHASES.WORKFLOW_EXECUTION, WORKFLOW_PHASE_STATUS.FAILED, {
    message: String(error?.message || error || ""),
  });
  await emitWorkflowRuntimeEvent({
    options,
    ctx,
    event: "workflow_execution_failed",
    level: "error",
    data: {
      message: String(error?.message || error || ""),
    },
  });
  const workflowPayload = buildWorkflowOrchestrationPayload({
    ctx,
    options,
    sourceText,
    semanticText: sourceText,
    semantic: null,
    execution: null,
    semanticResolution: { invoked: typeof options?.capabilityModelInvoker === "function" },
    phaseTimeline: phaseTracker.list(),
    retryMeta,
    error,
  });
  agentResult.workflow = workflowPayload;
  appendWorkflowTrace(agentResult, {
    stage: WORKFLOW_TRACE.STAGE_FAILED,
    interactionId: workflowPayload.interactionId,
    protocolVersion: workflowPayload.protocolVersion,
    message: String(error?.message || error || ""),
  });
  if (beforeDispatchMode) {
    ctx.skipAgentDispatch = false;
    ctx.overrideAgentResult = null;
    ctx.workflowFallbackToMainAgent = true;
    await emitWorkflowRuntimeEvent({
      options,
      ctx,
      event: "workflow_fallback_to_main_agent",
      level: "warn",
      data: {
        reason: "workflow_execution_failed",
        message: String(error?.message || error || ""),
      },
    });
  }
}

export async function handleBeforeAgentDispatch({
  hookManager,
  options = {},
  ctx = {},
  hookPoint = "",
} = {}) {
  const beforeDispatchMode =
    String(hookPoint || "").trim() === WORKFLOW_BOT_HOOK_POINTS.BEFORE_AGENT_DISPATCH;
  const sourceAgentResult =
    ctx?.agentResult && typeof ctx.agentResult === "object" ? ctx.agentResult : {};
  const agentResult = beforeDispatchMode
    ? { output: "", traces: [], turnMessages: [] }
    : sourceAgentResult;
  const phaseTracker = createPhaseTracker();
  const retryMeta = createWorkflowRetryMeta();

  phaseTracker.start(WORKFLOW_PHASES.HOOK_RECEIVED);
  await emitWorkflowRuntimeEvent({
    options,
    ctx,
    event: "workflow_hook_received_started",
  });
  throwIfWorkflowAborted(ctx);
  const sourceText = resolveWorkflowSourceText(ctx, sourceAgentResult, hookPoint);
  if (!sourceText) {
    phaseTracker.end(WORKFLOW_PHASES.HOOK_RECEIVED, WORKFLOW_PHASE_STATUS.SKIPPED, {
      reason: "empty_source_text",
    });
    await emitWorkflowRuntimeEvent({
      options,
      ctx,
      event: "workflow_hook_received_skipped",
      data: { reason: "empty_source_text" },
    });
    return;
  }
  phaseTracker.end(WORKFLOW_PHASES.HOOK_RECEIVED, WORKFLOW_PHASE_STATUS.SUCCEEDED, {
    sourceTextLength: sourceText.length,
  });
  await emitWorkflowRuntimeEvent({
    options,
    ctx,
    event: "workflow_hook_received_succeeded",
    data: { sourceTextLength: sourceText.length },
  });
  throwIfWorkflowAborted(ctx);

  try {
    phaseTracker.start(WORKFLOW_PHASES.SEMANTIC_RESOLUTION);
    await emitWorkflowRuntimeEvent({
      options,
      ctx,
      event: "workflow_semantic_resolution_started",
    });
    throwIfWorkflowAborted(ctx);
    const semanticResolution = await resolveSemanticText({ options, ctx, sourceText });
    throwIfWorkflowAborted(ctx);
    phaseTracker.end(
      WORKFLOW_PHASES.SEMANTIC_RESOLUTION,
      WORKFLOW_PHASE_STATUS.SUCCEEDED,
      {
        invoked: semanticResolution?.invoked === true,
        traceCount: Number(semanticResolution?.traceCount || 0),
      },
    );
    await emitWorkflowRuntimeEvent({
      options,
      ctx,
      event: "workflow_semantic_resolution_succeeded",
      data: {
        invoked: semanticResolution?.invoked === true,
        traceCount: Number(semanticResolution?.traceCount || 0),
      },
    });
    const semanticText = String(semanticResolution?.text || "").trim();
    throwIfWorkflowAborted(ctx);
    const planningPersistResult = await persistWorkflowPlanningDialog({
      options,
      ctx,
      sourceText,
      semanticText,
      semanticResolution,
    });
    await emitWorkflowRuntimeEvent({
      options,
      ctx,
      event: planningPersistResult ? "workflow_planning_persist_succeeded" : "workflow_planning_persist_skipped",
      data: {
        outputDir: String(planningPersistResult?.outputDir || "").trim(),
        outputFile: String(planningPersistResult?.outputFile || "").trim(),
      },
    });
    const { semantic } = executeWorkflowText({
      semanticText,
      options,
    });
    throwIfWorkflowAborted(ctx);
    await preparePlanningMessage({
      options,
      ctx,
      agentResult,
      sourceText,
      semanticText,
      semantic,
      semanticResolution,
      phaseTracker,
      retryMeta,
      planningPersistResult,
    });

    phaseTracker.start(WORKFLOW_PHASES.WORKFLOW_EXECUTION);
    throwIfWorkflowAborted(ctx);
    await emitWorkflowRuntimeEvent({
      options,
      ctx,
      event: "workflow_execution_started",
    });
    const { execution, nodeAgentRuns, instanceId } = await runWorkflowExecution({
      hookManager,
      options,
      ctx,
      semantic,
    });
    phaseTracker.end(WORKFLOW_PHASES.WORKFLOW_EXECUTION, WORKFLOW_PHASE_STATUS.SUCCEEDED, {
      completed: execution.completed,
      pendingStepCount: execution.pendingStepCount,
      instanceId,
    });
    await emitWorkflowRuntimeEvent({
      options,
      ctx,
      event: "workflow_execution_succeeded",
      data: {
        instanceId,
        completed: execution.completed,
        pendingStepCount: execution.pendingStepCount,
        autoTransitions: execution.autoTransitions,
      },
    });
    retryMeta.history.push({
      attempt: 1,
      status: WORKFLOW_PHASE_STATUS.SUCCEEDED,
      timestamp: new Date().toISOString(),
    });
    phaseTracker.start(WORKFLOW_PHASES.PAYLOAD_BUILD);
    throwIfWorkflowAborted(ctx);

    const workflowPayload = buildWorkflowOrchestrationPayload({
      ctx,
      options,
      sourceText,
      semanticText,
      semantic,
      execution,
      semanticResolution,
      phaseTimeline: phaseTracker.list(),
      retryMeta,
    });
    phaseTracker.end(WORKFLOW_PHASES.PAYLOAD_BUILD, WORKFLOW_PHASE_STATUS.SUCCEEDED);
    workflowPayload.phaseTimeline = phaseTracker.list();
    await emitWorkflowRuntimeEvent({
      options,
      ctx,
      event: "workflow_payload_build_succeeded",
      data: {
        interactionId: String(workflowPayload?.interactionId || "").trim(),
      },
    });
    const { workflowAttachmentMetas } = enrichWorkflowPayload({
      workflowPayload,
      ctx,
      semantic,
      nodeAgentRuns,
      planningPersistResult,
    });

    agentResult.workflow = workflowPayload;
    await appendWorkflowPlanningMessage({
      options,
      agentResult,
      ctx,
      sourceText,
      semanticText,
      semanticResolution,
      workflowPayload,
      attachmentMetas: workflowAttachmentMetas,
    });
    appendWorkflowTrace(agentResult, {
      stage: WORKFLOW_TRACE.STAGE_EXECUTED,
      interactionId: workflowPayload.interactionId,
      protocolVersion: workflowPayload.protocolVersion,
      completed: execution?.completed === true,
      pendingStepCount: execution?.pendingStepCount ?? 0,
      autoTransitions: execution?.autoTransitions ?? 0,
    });
    if (beforeDispatchMode) {
      ctx.skipAgentDispatch = true;
      ctx.overrideAgentResult = agentResult;
    }
  } catch (error) {
    if (isWorkflowAbortError(error, ctx)) {
      throw error;
    }
    await handleWorkflowFailure({
      error,
      options,
      ctx,
      agentResult,
      sourceText,
      phaseTracker,
      retryMeta,
      beforeDispatchMode,
    });
  }
}
