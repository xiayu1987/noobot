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
  if (skipped) return;

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
    // Semantic parsing is the ownership boundary: before this point the hook
    // can still fall back to the main Agent. Once a valid workflow is accepted,
    // the workflow owns root-turn processing and must publish RUNNING before
    // planning or child sessions begin.
    ctx?.claimAgentDispatch?.({ source: "workflow_before_agent_dispatch" });
    const workflowRunId = resolveWorkflowRunId(ctx);
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
