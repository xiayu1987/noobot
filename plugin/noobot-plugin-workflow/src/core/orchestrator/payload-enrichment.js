/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

import {
  mergeAttachmentMetas,
  normalizeWorkflowTransferPayload,
  resolveWorkflowAttachmentMetasFromTransferPayload,
} from "../hooks/attachments.js";
import { resolveSemanticNodeForPendingStep } from "../hooks/node-agent.js";

export function buildWorkflowNodeSessions({
  ctx = {},
  semantic = {},
  nodeAgentRuns = [],
} = {}) {
  return (Array.isArray(nodeAgentRuns) ? nodeAgentRuns : [])
    .map((item = {}) => {
      const semanticNode = resolveSemanticNodeForPendingStep({
        semantic,
        pendingStep: item?.step || {},
      });
      return {
        transition: Number(item?.transition || 0),
        nodeName: String(item?.step?.nodeName || semanticNode?.name || "").trim(),
        nodeId: String(item?.step?.nodeId || semanticNode?.id || "").trim(),
        nodeType: Number.isFinite(Number(item?.step?.nodeType))
          ? Number(item.step.nodeType)
          : undefined,
        actionNodeStateId: String(item?.actionNodeStateId || item?.step?.actionNodeStateId || "").trim(),
        stepId: String(item?.stepId || item?.step?.stepId || "").trim(),
        stepIndex: Number.isFinite(Number(item?.stepIndex ?? item?.step?.stepIndex))
          ? Number(item?.stepIndex ?? item?.step?.stepIndex)
          : undefined,
        type: String(semanticNode?.type || "").trim(),
        stateType:
          semanticNode && Number.isFinite(Number(semanticNode?.stateType))
            ? Number(semanticNode.stateType)
            : undefined,
        rootSessionId: String(ctx?.sessionId || "").trim(),
        dialogId: String(item?.nodeDialogId || "").trim(),
        sessionId: String(item?.nodeSessionId || "").trim(),
        transferEnvelopes: Array.isArray(item?.nodeResultTransferEnvelopes)
          ? item.nodeResultTransferEnvelopes
          : [],
        ...(item?.nodeResultTransferResult && typeof item.nodeResultTransferResult === "object"
          ? { transferResult: item.nodeResultTransferResult }
          : {}),
        stepStatus: String(item?.stepFailure ? "failed" : item?.stepStatus || "success").trim(),
        stepFailure:
          item?.stepFailure && typeof item.stepFailure === "object"
            ? item.stepFailure
            : null,
        parallelWave: Number(item?.parallelWave || 0),
        waveOrder: Number(item?.waveOrder || 0),
      };
    })
    .filter(
      (item) =>
        item.dialogId ||
        item.sessionId ||
        item.stepId ||
        item.actionNodeStateId ||
        item.nodeId ||
        item.nodeName,
    );
}

export function resolveWorkflowAttachmentMetasFromNodeRuns({
  ctx = {},
  nodeAgentRuns = [],
} = {}) {
  return (Array.isArray(nodeAgentRuns) ? nodeAgentRuns : []).reduce((acc, item = {}) => {
    const transferPayload = normalizeWorkflowTransferPayload({
      transferResult: item?.nodeResultTransferResult || null,
      transferEnvelopes: Array.isArray(item?.nodeResultTransferEnvelopes) ? item.nodeResultTransferEnvelopes : [],
    });
    const metas = resolveWorkflowAttachmentMetasFromTransferPayload(transferPayload, ctx);
    return mergeAttachmentMetas(
      acc,
      metas.length
        ? metas
        : Array.isArray(item?.nodeResultAttachmentMetas)
          ? item.nodeResultAttachmentMetas
          : [],
    );
  }, []);
}

export function resolveWorkflowTransferEnvelopesFromNodeRuns(nodeAgentRuns = []) {
  return (Array.isArray(nodeAgentRuns) ? nodeAgentRuns : []).flatMap((item = {}) => {
    if (Array.isArray(item?.nodeResultTransferEnvelopes) && item.nodeResultTransferEnvelopes.length) {
      return item.nodeResultTransferEnvelopes;
    }
    return [];
  });
}

export function enrichWorkflowPayload({
  workflowPayload = {},
  ctx = {},
  semantic = {},
  nodeAgentRuns = [],
  planningPersistResult = null,
} = {}) {
  workflowPayload.planningDialog = {
    dialogId: String(ctx?.dialogProcessId || "").trim(),
    sessionId: String(ctx?.sessionId || "").trim(),
    storagePath: String(planningPersistResult?.outputDir || "").trim(),
    storageFile: String(planningPersistResult?.outputFile || "").trim(),
  };
  workflowPayload.nodeSessions = buildWorkflowNodeSessions({ ctx, semantic, nodeAgentRuns });
  const workflowAttachmentMetas = resolveWorkflowAttachmentMetasFromNodeRuns({
    ctx,
    nodeAgentRuns,
  });
  workflowPayload.transferEnvelopes = resolveWorkflowTransferEnvelopesFromNodeRuns(nodeAgentRuns);
  return {
    workflowPayload,
    workflowAttachmentMetas,
  };
}
