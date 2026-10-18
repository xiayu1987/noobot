/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

import { HOOK_POINT } from "@noobot/hook-protocol";
import { executeWorkflowText } from "../../workflow/adapter.js";
import { isWorkflowAbortError, throwIfWorkflowAborted } from "../hooks/runtime.js";
import { createPhaseTracker } from "../hooks/phase.js";
import { prepareWorkflowPlanningMessage } from "./planning-message.js";
import {
  buildWorkflowPlanningNodeSessions,
  resolveWorkflowRunIdentity,
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
} from "@noobot/agent-transport-protocol/bot-dispatch";
import { text } from "@noobot/shared/value";

export async function handleBeforeAgentDispatch({
  hookManager,
  options = {},
  ctx = {},
  signal,
  hookPoint = "",
} = {}) {
  const beforeDispatchMode = text(hookPoint) === HOOK_POINT.BOT.BEFORE_AGENT_DISPATCH;
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
    signal,
    sourceAgentResult,
    hookPoint,
    phaseTracker,
  });
  if (skipped) return createBotDispatchPass({ owner: "workflow" });

  const { workflowRunId } = resolveWorkflowRunIdentity(ctx);
  ctx.claimAgentDispatch({ owner: "workflow", source: "workflow_before_agent_dispatch" });

  try {
    const { semanticResolution, semanticText } = await runSemanticResolutionStage({
      options,
      ctx,
      signal,
      sourceText,
      phaseTracker,
    });
    throwIfWorkflowAborted(signal);
    const { semantic } = executeWorkflowText({
      semanticText,
      options,
    });
    const planningNodeSessions = buildWorkflowPlanningNodeSessions({ workflowRunId, semantic });
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
      workflowRunId,
      planningNodeSessions,
    });

    const { execution, nodeAgentRuns, nodeStateSnapshot } = await runWorkflowExecutionStage({
      hookManager,
      options,
      ctx,
      signal,
      semantic,
      workflowRunId,
      planningNodeSessions,
      phaseTracker,
    });
    markWorkflowRetrySucceeded(retryMeta);
    const { workflowPayload } = await buildFinalWorkflowPayload({
      workflowRunId,
      options,
      ctx,
      signal,
      sourceText,
      semanticText,
      semantic,
      execution,
      semanticResolution,
      phaseTracker,
      retryMeta,
      nodeAgentRuns,
      nodeStateSnapshot,
    });

    await publishWorkflowResult({
      options,
      ctx,
      agentResult,
      sourceText,
      semanticText,
      workflowPayload,
      execution,
    });
    return createBotDispatchHandled({ owner: "workflow", result: agentResult });
  } catch (error) {
    if (isWorkflowAbortError(error, signal)) {
      throw error;
    }
    return handleWorkflowFailure({
      workflowRunId,
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
