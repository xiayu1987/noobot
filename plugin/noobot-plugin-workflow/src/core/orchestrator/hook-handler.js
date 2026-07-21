/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

import { WORKFLOW_BOT_HOOK_POINTS } from "../constants.js";
import { executeWorkflowText } from "../../workflow/adapter.js";
import {
  isWorkflowAbortError,
  throwIfWorkflowAborted,
} from "../hooks/runtime.js";
import { createPhaseTracker } from "../hooks/phase.js";
import {
  emitWorkflowRuntimeEvent,
  persistWorkflowPlanningDialog,
} from "../hooks/persistence.js";
import { prepareWorkflowPlanningMessage } from "./planning-message.js";
import {
  buildWorkflowPlanningNodeSessions,
  resolveWorkflowRunId,
} from "../workflow-run-identity.js";
import { handleWorkflowFailure } from "./failure-handler.js";
import { publishWorkflowResult } from "./result-publisher.js";
import { buildFinalWorkflowPayload } from "./payload-builder.js";
import { receiveWorkflowSource } from "./source-receiver.js";
import { runSemanticResolutionStage } from "./semantic-stage.js";
import { runWorkflowExecutionStage } from "./execution-stage.js";
import { createWorkflowRetryMeta, markWorkflowRetrySucceeded } from "./retry-meta.js";
import {
  createBotDispatchHandled,
  createBotDispatchPass,
} from "@noobot/shared/bot-dispatch-protocol";

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

  const { sourceText, skipped } = await receiveWorkflowSource({
    options,
    ctx,
    sourceAgentResult,
    hookPoint,
    phaseTracker,
  });
  if (skipped) return createBotDispatchPass({ owner: "workflow" });

  // A non-empty request routed to the workflow plugin is exclusively owned by
  // workflow orchestration. Planning, node execution, and failure reporting
  // must never fall through and execute the same user task in the root Agent.
  const workflowRunId = resolveWorkflowRunId(ctx);
  const workflowExecutionId = String(
    ctx?.executionId || ctx?.runConfig?.executionId || `workflow:${workflowRunId}`,
  ).trim();
  const rootExecutionId = String(
    ctx?.rootExecutionId || ctx?.runConfig?.rootExecutionId || workflowExecutionId,
  ).trim();
  ctx.workflowExecutionId = workflowExecutionId;
  ctx.rootExecutionId = rootExecutionId;
  ctx?.claimAgentDispatch?.({
    owner: "workflow",
    source: "workflow_before_agent_dispatch",
    executionId: workflowExecutionId,
    executionKind: "workflow",
    rootExecutionId,
    origin: { type: "workflow", workflowRunId },
    stage: "planning",
  });

  try {
    const { semanticResolution, semanticText } = await runSemanticResolutionStage({
      options,
      ctx,
      sourceText,
      phaseTracker,
    });
    throwIfWorkflowAborted(ctx);
    const { semantic } = executeWorkflowText({
      semanticText,
      options,
    });
    const planningNodeSessions = buildWorkflowPlanningNodeSessions({ workflowRunId, semantic });
    const planningPersistResult = await persistWorkflowPlanningDialog({
      options,
      ctx,
      sourceText,
      semanticText,
      semanticResolution,
      semantic,
      workflowRunId,
      planningNodeSessions,
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
    throwIfWorkflowAborted(ctx);
    await prepareWorkflowPlanningMessage({
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
      workflowRunId,
      planningNodeSessions,
    });

    const { execution, nodeAgentRuns } = await runWorkflowExecutionStage({
      hookManager,
      options,
      ctx,
      semantic,
      workflowRunId,
      planningNodeSessions,
      phaseTracker,
    });
    markWorkflowRetrySucceeded(retryMeta);
    const { workflowPayload, workflowAttachments } = await buildFinalWorkflowPayload({
      options,
      ctx,
      sourceText,
      semanticText,
      semantic,
      execution,
      semanticResolution,
      phaseTracker,
      retryMeta,
      nodeAgentRuns,
      planningPersistResult,
    });

    await publishWorkflowResult({
      options,
      ctx,
      agentResult,
      sourceText,
      semanticText,
      semanticResolution,
      workflowPayload,
      workflowAttachments,
      execution,
      beforeDispatchMode,
    });
    return createBotDispatchHandled({ owner: "workflow", result: agentResult });
  } catch (error) {
    if (isWorkflowAbortError(error, ctx)) {
      throw error;
    }
    return handleWorkflowFailure({
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
