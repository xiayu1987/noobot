/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

import { WORKFLOW_TRACE } from "../constants.js";
import { appendWorkflowTrace } from "../hooks/phase.js";
import { emitWorkflowRuntimeEvent, publishWorkflowFinalMessage } from "../hooks/persistence.js";

export async function publishWorkflowResult({
  options = {},
  ctx = {},
  agentResult = {},
  sourceText = "",
  semanticText = "",
  semanticResolution = {},
  workflowPayload = {},
  nodeAgentRuns = [],
  execution = {},
  beforeDispatchMode = false,
} = {}) {
  agentResult.workflow = workflowPayload;
  const workflowMessage = await publishWorkflowFinalMessage({
    options,
    agentResult,
    ctx,
    sourceText,
    semanticText,
    semanticResolution,
    workflowPayload,
    nodeAgentRuns,
  });
  await emitWorkflowRuntimeEvent({
    options,
    ctx,
    event: "workflow_final_message_published",
    data: {
      messageId: String(workflowMessage?.messageId || "").trim(),
      presentationMessageId: String(workflowMessage?.presentationMessageId || "").trim(),
      workflowRunId: String(
        workflowPayload?.workflowRunId || workflowPayload?.execution?.workflowRunId || "",
      ).trim(),
      phase: String(workflowMessage?.pluginMeta?.phase || "").trim(),
      contentLength: String(workflowMessage?.content || "").length,
      nodeResultCount: (Array.isArray(nodeAgentRuns) ? nodeAgentRuns : []).filter(
        (item = {}) => String(item?.nodeResultText || "").trim(),
      ).length,
      attachmentCount: Array.isArray(workflowMessage?.attachments) ? workflowMessage.attachments.length : 0,
      transferEnvelopeCount: Array.isArray(workflowMessage?.transferEnvelopes)
        ? workflowMessage.transferEnvelopes.length
        : 0,
    },
  });
  appendWorkflowTrace(agentResult, {
    stage: WORKFLOW_TRACE.STAGE_EXECUTED,
    interactionId: workflowPayload.interactionId,
    protocolVersion: workflowPayload.protocolVersion,
    completed: execution?.completed === true,
    pendingStepCount: execution?.pendingStepCount ?? 0,
    autoTransitions: execution?.autoTransitions ?? 0,
  });
}
