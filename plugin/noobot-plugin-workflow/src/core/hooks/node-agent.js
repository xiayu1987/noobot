/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

import { WORKFLOW_ACTION, WORKFLOW_PLUGIN_DEFAULTS } from "../constants.js";
import { HOOK_POINT } from "@noobot/hook-protocol";
import { resolveWorkflowLocaleFromContext, tWorkflow, WORKFLOW_I18N_KEYSET } from "../i18n.js";
import {
  getWorkflowTransferPayloadFromResult,
  mergeAttachmentReferences,
  mergeAttachments,
  normalizeAttachmentRefs,
  normalizeWorkflowTransferPayload,
  resolveNodeInputAttachments,
  resolveWorkflowTransferAttachmentReferences,
} from "./attachments.js";
import {
  buildWorkflowDialogRelativeDir,
  persistWorkflowNodeResultAttachment,
} from "./persistence.js";
import {
  hasOwnObjectKey,
  isWorkflowAbortError,
  resolveWorkflowAbortSignal,
  resolveWorkflowParentRunConfig,
  resolveWorkflowRuntimeFromContext,
  throwIfWorkflowAborted,
  withTimeout,
} from "./runtime.js";
import { resolveWorkflowNodeDialogProcessId } from "../node-dialog-process-id.js";

export function buildWorkflowInputAttachmentSystemMessage({
  ctx = {},
  attachments = [],
  semanticNode = {},
} = {}) {
  const normalizedAttachments = Array.isArray(attachments) ? attachments : [];
  const locale = resolveWorkflowLocaleFromContext(ctx);
  const lines = normalizedAttachments
    .map((item = {}, index) => {
      const label = String(
          item?.name ||
          item?.fileName ||
          tWorkflow(locale, WORKFLOW_I18N_KEYSET.INPUT.DEFAULT_LABEL, { index: index + 1 }),
      ).trim();
      const attachmentId = String(item?.attachmentId || item?.id || "").trim();
      if (!attachmentId) return "";
      return `- ${label} (${attachmentId})`;
    })
    .filter(Boolean);
  if (!lines.length) return "";
  const nodeName = String(
    semanticNode?.name || semanticNode?.id || tWorkflow(locale, WORKFLOW_I18N_KEYSET.COMMON.CURRENT_NODE_FALLBACK),
  ).trim();
  return [
    tWorkflow(locale, WORKFLOW_I18N_KEYSET.INPUT.USER_RAW_TITLE),
    "",
    tWorkflow(locale, WORKFLOW_I18N_KEYSET.COMMON.CURRENT_NODE_LINE, { name: nodeName }),
    "",
    tWorkflow(locale, WORKFLOW_I18N_KEYSET.INPUT.SYSTEM_HINT),
    "",
    ...lines,
  ].join("\n");
}

export function buildWorkflowUpstreamAttachmentResults({
  upstreamActionSteps = [],
  completedStepResults = new Map(),
} = {}) {
  return (Array.isArray(upstreamActionSteps) ? upstreamActionSteps : [])
    .map((upstreamStep = {}) => {
      const upstreamNodeId = String(upstreamStep?.nodeId || "").trim();
      if (!upstreamNodeId) return null;
      const upstreamStepId = String(upstreamStep?.stepId || "").trim();
      const completed = completedStepResults.get(upstreamStepId) || {};
      const transferPayload = getWorkflowTransferPayloadFromResult(completed);
      const transferEnvelopes = transferPayload.transferEnvelopes;
      const status = String(completed?.status || upstreamStep?.status || "").trim();
      const stepFailure =
        completed?.stepFailure && typeof completed.stepFailure === "object"
          ? completed.stepFailure
          : upstreamStep?.stepFailure && typeof upstreamStep.stepFailure === "object"
            ? upstreamStep.stepFailure
            : null;
      const transferFiles = resolveWorkflowTransferAttachmentReferences(
        { transferEnvelopes },
        {},
      );
      if (!transferFiles.length && status !== "failed" && !stepFailure) return null;
      return {
        nodeId: upstreamNodeId,
        nodeName: String(completed?.nodeName || upstreamStep?.nodeName || upstreamNodeId).trim(),
        nodeTask: String(completed?.nodeTask || upstreamStep?.nodeTask || upstreamStep?.task || "").trim(),
        actionNodeStateId: String(
          completed?.actionNodeStateId || upstreamStep?.actionNodeStateId || "",
        ).trim(),
        stepId: upstreamStepId,
        stepIndex: Number.isFinite(Number(completed?.stepIndex ?? upstreamStep?.stepIndex))
          ? Number(completed?.stepIndex ?? upstreamStep?.stepIndex)
          : -1,
        transition: Number(completed?.transition || 0),
        nodeDialogProcessId: resolveWorkflowNodeDialogProcessId(completed),
        nodeSessionId: String(completed?.nodeSessionId || "").trim(),
        status,
        stepFailure,
        transferEnvelopes,
      };
    })
    .filter(Boolean);
}

export async function buildWorkflowUpstreamAttachmentSystemMessage({
  options = {},
  ctx = {},
  pendingStep = {},
  upstreamNodeResults = [],
} = {}) {
  const locale = resolveWorkflowLocaleFromContext(ctx);
  const normalizedResults = Array.isArray(upstreamNodeResults) ? upstreamNodeResults : [];
  const failedResults = normalizedResults.filter((item = {}) => {
    const status = String(item?.status || "").trim();
    return status === "failed" || (item?.stepFailure && typeof item.stepFailure === "object");
  });
  const hasTransferFiles = normalizedResults.some((item = {}) =>
    resolveWorkflowTransferAttachmentReferences(
      {
        transferEnvelopes: Array.isArray(item?.transferEnvelopes) ? item.transferEnvelopes : [],
      },
      ctx,
    ).length > 0,
  );
  if (!hasTransferFiles && !failedResults.length) return "";
  let customUpstreamMessage = "";
  if (typeof options?.workflowNodeSystemMessageBuilder === "function") {
    try {
      const customMessage = String(
        options.workflowNodeSystemMessageBuilder({
          ctx,
          pendingStep,
          upstreamNodeResults: normalizedResults,
          attachments: [],
        }) || "",
      ).trim();
      if (customMessage) customUpstreamMessage = customMessage;
    } catch {
    }
  }

  const lines = [];
  const failureLines = [];
  for (const result of normalizedResults) {
    const nodeLabel = String(
      result?.nodeName ||
      result?.nodeId ||
      tWorkflow(locale, WORKFLOW_I18N_KEYSET.NODE_AGENT.UPSTREAM_NODE_FALLBACK),
    ).trim();
    const nodeTask = String(result?.nodeTask || result?.task || "").trim();
    if (
      String(result?.status || "").trim() === "failed" ||
      (result?.stepFailure && typeof result.stepFailure === "object")
    ) {
      const failureMessage = String(
        result?.stepFailure?.message ||
        tWorkflow(locale, WORKFLOW_I18N_KEYSET.NODE_AGENT.SUB_AGENT_FAILURE_FALLBACK),
      ).trim();
      failureLines.push(
        nodeTask
          ? tWorkflow(locale, WORKFLOW_I18N_KEYSET.NODE_AGENT.FAILURE_LINE_WITH_TASK, {
              nodeLabel,
              task: nodeTask,
              message: failureMessage,
            })
          : tWorkflow(locale, WORKFLOW_I18N_KEYSET.NODE_AGENT.FAILURE_LINE_WITHOUT_TASK, {
              nodeLabel,
              message: failureMessage,
            }),
      );
    }
    const transferFiles = resolveWorkflowTransferAttachmentReferences(
      {
        transferEnvelopes: Array.isArray(result?.transferEnvelopes) ? result.transferEnvelopes : [],
      },
      ctx,
    );
    for (const [index, file] of transferFiles.entries()) {
      const attachmentLabel = String(
        file?.name ||
          tWorkflow(locale, WORKFLOW_I18N_KEYSET.INPUT.DEFAULT_LABEL, { index: index + 1 }),
      ).trim();
      const attachmentId = String(file?.identity?.attachmentId || "").trim();
      if (!attachmentId) continue;
      lines.push(`- ${nodeLabel} / ${attachmentLabel}: ${attachmentId}`);
    }
  }
  if (!lines.length && !failureLines.length) return "";
  const pendingName = String(
    pendingStep?.nodeName ||
    pendingStep?.nodeId ||
    tWorkflow(locale, WORKFLOW_I18N_KEYSET.COMMON.CURRENT_NODE_FALLBACK),
  ).trim();
  const message = customUpstreamMessage || [
    tWorkflow(locale, WORKFLOW_I18N_KEYSET.NODE_AGENT.UPSTREAM_ATTACHMENTS_TITLE),
    "",
    tWorkflow(locale, WORKFLOW_I18N_KEYSET.COMMON.CURRENT_NODE_LINE, { name: pendingName }),
    "",
    tWorkflow(locale, WORKFLOW_I18N_KEYSET.NODE_AGENT.UPSTREAM_HINT),
    "",
    failureLines.length ? tWorkflow(locale, WORKFLOW_I18N_KEYSET.NODE_AGENT.UPSTREAM_FAILURE_TITLE) : "",
    ...failureLines,
    failureLines.length && lines.length ? "" : "",
    lines.length ? tWorkflow(locale, WORKFLOW_I18N_KEYSET.NODE_AGENT.UPSTREAM_RESULT_TITLE) : "",
    ...lines,
  ].join("\n");
  const runtime = resolveWorkflowRuntimeFromContext(ctx);
  const transferSemanticContent = runtime?.sharedTools?.semanticTransfer?.transferSemanticContent;
  if (typeof transferSemanticContent !== "function") return message;
  try {
    const strategy = failureLines.length
      ? "workflow_subagent"
      : "workflow_subagent";
    const transferred = await transferSemanticContent({
      scenario: "workflow",
      strategy,
      content: message,
      producer: { type: "plugin", id: `workflow-upstream:${pendingName}` },
      meta: {
        pendingNodeId: String(pendingStep?.nodeId || "").trim(),
        pendingNodeName: pendingName,
        upstreamResultCount: normalizedResults.length,
        upstreamAttachmentLineCount: lines.length,
        failureCount: failureLines.length,
      },
    });
    return String(transferred?.injectionMessage || message).trim() || message;
  } catch {
    return message;
  }

}

export function buildWorkflowNodeInstruction(step = {}) {
  const locale = String(step?.locale || "").trim();
  const taskText = String(
    step?.nodeTask ||
      step?.task ||
      step?.instruction ||
      step?.mission ||
      "",
  ).trim();
  if (taskText) return taskText;
  const nodeName = String(step?.nodeName || "").trim();
  if (nodeName) {
    return tWorkflow(locale, WORKFLOW_I18N_KEYSET.NODE_AGENT.NODE_INSTRUCTION_BY_NAME, { name: nodeName });
  }
  const nodeId = String(step?.nodeId || "").trim();
  if (nodeId) return tWorkflow(locale, WORKFLOW_I18N_KEYSET.NODE_AGENT.NODE_INSTRUCTION_BY_ID, { id: nodeId });
  return tWorkflow(locale, WORKFLOW_I18N_KEYSET.NODE_AGENT.NODE_INSTRUCTION_DEFAULT);
}

export function resolveNodeTaskForPendingStep({ semantic = {}, pendingStep = {} } = {}) {
  const pendingNodeId = String(pendingStep?.nodeId || "").trim();
  const pendingNodeName = String(pendingStep?.nodeName || "").trim();
  const nodes = Array.isArray(semantic?.nodes) ? semantic.nodes : [];
  const matchedNode = nodes.find((node = {}) => {
    const nodeId = String(node?.id || "").trim();
    const nodeName = String(node?.name || "").trim();
    if (pendingNodeId && nodeId && pendingNodeId === nodeId) return true;
    if (pendingNodeName && nodeName && pendingNodeName === nodeName) return true;
    return false;
  });
  if (!matchedNode) return "";
  return String(
    matchedNode?.task ||
      matchedNode?.taskText ||
      matchedNode?.instruction ||
      matchedNode?.mission ||
      "",
  ).trim();
}

export function resolveSemanticNodeForPendingStep({ semantic = {}, pendingStep = {} } = {}) {
  const pendingNodeId = String(pendingStep?.nodeId || "").trim();
  const pendingNodeName = String(pendingStep?.nodeName || "").trim();
  const nodes = Array.isArray(semantic?.nodes) ? semantic.nodes : [];
  return (
    nodes.find((node = {}) => {
      const nodeId = String(node?.id || "").trim();
      const nodeName = String(node?.name || "").trim();
      if (pendingNodeId && nodeId && pendingNodeId === nodeId) return true;
      if (pendingNodeName && nodeName && pendingNodeName === nodeName) return true;
      return false;
    }) || null
  );
}

export function resolveWorkflowInstanceId(ctx = {}) {
  const provided = String(
    ctx?.workflowInstanceId ||
      ctx?.runConfig?.workflowInstanceId ||
      "",
  ).trim();
  if (provided) return provided;
  const base = String(ctx?.dialogProcessId || ctx?.sessionId || "session").trim() || "session";
  return `wf_inst_${base}_${Date.now()}`;
}

export async function runNodeAgent({
  hookManager,
  options = {},
  ctx = {},
  instanceId = "",
  pendingStep = {},
  semantic = {},
  nodeIdentity = null,
  transition = 0,
  upstreamNodeResults = [],
} = {}) {
  throwIfWorkflowAborted(ctx);
  const identity = nodeIdentity && typeof nodeIdentity === "object" ? nodeIdentity : null;
  if (!identity) throw new TypeError("workflow node identity is required");
  const nodeDialogProcessId = String(identity.dialogProcessId || "").trim();
  const nodeTurnScopeId = String(identity.turnScopeId || "").trim();
  if (!nodeDialogProcessId || !nodeTurnScopeId) {
    throw new TypeError("workflow node identity requires dialogProcessId and turnScopeId");
  }
  const nodeCommandId = String(identity?.commandId || "").trim();
  const nodeExecutionId = String(identity?.nodeExecutionId || "").trim();
  const workflowRunId = String(identity?.workflowRunId || instanceId || "").trim();
  const childExecutionId = String(identity?.childExecutionId || `agent:${nodeTurnScopeId}`).trim();
  const childSessionId = String(identity?.sessionId || "").trim();
  const workflowExecutionId = String(
    identity?.workflowExecutionId ||
      ctx?.workflowExecutionId ||
      ctx?.executionId ||
      ctx?.runConfig?.executionId ||
      `workflow:${workflowRunId}`,
  ).trim();
  const resolvedNodeIdentity = {
    ...(identity || {}),
    workflowRunId,
    nodeExecutionId,
    commandId: nodeCommandId,
    dialogProcessId: nodeDialogProcessId,
    turnScopeId: nodeTurnScopeId,
    childExecutionId,
    sessionId: childSessionId,
    workflowExecutionId,
    nodeId: String(identity?.nodeId || pendingStep?.nodeId || "").trim(),
    nodeName: String(identity?.nodeName || pendingStep?.nodeName || "").trim(),
  };
  const semanticNode = resolveSemanticNodeForPendingStep({ semantic, pendingStep }) || {};
  const nodeInputAttachments = resolveNodeInputAttachments({
    ctx,
    semanticNode,
    semantic,
  });
  const hookPayload = {
    ...ctx,
    workflow: {
      instanceId,
      workflowRunId,
      nodeIdentity: resolvedNodeIdentity,
      pendingStep,
      transition,
      semantic,
      semanticNode,
    },
    agentInstruction: buildWorkflowNodeInstruction({
      ...pendingStep,
      locale: resolveWorkflowLocaleFromContext(ctx),
      nodeTask: resolveNodeTaskForPendingStep({ semantic, pendingStep }),
    }),
    proposedAction: { type: WORKFLOW_ACTION.SUBMIT, stepIndex: Number(pendingStep?.index || 0) },
  };
  const inputAttachmentSystemMessage = buildWorkflowInputAttachmentSystemMessage({
    ctx,
    attachments: nodeInputAttachments,
    semanticNode,
  });
  const upstreamAttachmentSystemMessage = await buildWorkflowUpstreamAttachmentSystemMessage({
    options,
    ctx,
    pendingStep,
    upstreamNodeResults,
  });
  const subSessionSystemMessages = [
    inputAttachmentSystemMessage,
    upstreamAttachmentSystemMessage,
  ].filter(Boolean);
  hookPayload.workflow.upstreamNodeResults = upstreamNodeResults;
  hookPayload.workflow.upstreamAttachments = upstreamNodeResults.reduce((acc, item = {}) => {
    const transferPayload = normalizeWorkflowTransferPayload({
      transferEnvelopes: Array.isArray(item?.transferEnvelopes) ? item.transferEnvelopes : [],
    });
    const attachments = resolveWorkflowTransferAttachmentReferences(transferPayload, ctx);
    return mergeAttachmentReferences(acc, attachments);
  }, []);
  hookPayload.workflow.inputAttachments = nodeInputAttachments;
  hookPayload.workflow.inputAttachmentSystemMessage = inputAttachmentSystemMessage;
  hookPayload.workflow.upstreamAttachmentSystemMessage = upstreamAttachmentSystemMessage;
  let subSession = null;
  let subSessionFailure = null;
  if (typeof options?.subSessionRunner === "function") {
    const parentRunConfig = resolveWorkflowParentRunConfig(ctx);
    const parentSelectedPlugins = Array.isArray(parentRunConfig?.selectedPlugins)
      ? parentRunConfig.selectedPlugins.map((item) => String(item || "").trim()).filter(Boolean)
      : [];
    const parentHarness =
      parentRunConfig?.plugins?.harness && typeof parentRunConfig.plugins.harness === "object"
        ? parentRunConfig.plugins.harness
        : {};
    const parentHarnessMode = String(parentHarness?.mode || "").trim().toLowerCase();
    const parentHarnessEnabled =
      parentSelectedPlugins.includes("harness") ||
      parentHarness?.enabled === true ||
      parentHarnessMode === "on";
    const streamingPatch = hasOwnObjectKey(parentRunConfig, "streaming")
      ? { streaming: parentRunConfig.streaming }
      : {};
    const turnScopePatch = { turnScopeId: nodeTurnScopeId };
    const workflowIdentityRunConfigPatch = {
      workflowRunId,
      workflowNodeExecutionId: nodeExecutionId,
      workflowNodeCommandId: nodeCommandId,
    };
    const subSessionRunConfigPatch = parentHarnessEnabled
      ? {
          ...streamingPatch,
          ...turnScopePatch,
          ...workflowIdentityRunConfigPatch,
          selectedPlugins: Array.from(new Set([...parentSelectedPlugins, "harness"])),
          plugins: {
            harness: {
              ...(parentHarness && typeof parentHarness === "object" ? parentHarness : {}),
              enabled: true,
              mode: "on",
            },
          },
        }
      : {
          ...streamingPatch,
          ...turnScopePatch,
          ...workflowIdentityRunConfigPatch,
        };
    const relativeDir = buildWorkflowDialogRelativeDir({
      ctx,
      dialogProcessId: nodeDialogProcessId,
      scope: "node",
    });
    try {
      throwIfWorkflowAborted(ctx);
      const nodeAgentTimeoutMs = Number.isFinite(Number(options?.nodeAgentTimeoutMs))
        ? Math.max(1000, Math.floor(Number(options.nodeAgentTimeoutMs)))
        : WORKFLOW_PLUGIN_DEFAULTS.DEFAULT_NODE_AGENT_TIMEOUT_MS;
      const subSessionRunPromise = Promise.resolve(options.subSessionRunner({
          parentExecutionScope: ctx?.agentContext || null,
          parentContext: ctx,
          abortSignal: resolveWorkflowAbortSignal(ctx),
          message: hookPayload.agentInstruction,
          attachments: nodeInputAttachments,
          runConfigPatch: subSessionRunConfigPatch,
          systemMessages: subSessionSystemMessages,
          eventListener:
            ctx?.eventListener && typeof ctx.eventListener?.onEvent === "function"
              ? ctx.eventListener
              : null,
          strategy: {
            sessionId: childSessionId,
            parentSessionId: String(ctx?.sessionId || "").trim(),
            parentDialogProcessId: String(ctx?.dialogProcessId || "").trim(),
            dialogProcessId: nodeDialogProcessId,
            turnScopeId: nodeTurnScopeId,
            commandId: nodeCommandId,
            executionId: childExecutionId,
            parentExecutionId: workflowExecutionId,
            rootExecutionId: String(ctx?.rootExecutionId || workflowExecutionId).trim(),
            disabledPlugins: ["workflow"],
            relativeDir,
            allowedRoot: "runtime/workflow/session",
          },
          metadata: {
            scope: "workflow_node",
            instanceId: String(instanceId || "").trim(),
            workflowRunId,
            executionId: childExecutionId,
            parentExecutionId: workflowExecutionId,
            rootExecutionId: String(ctx?.rootExecutionId || workflowExecutionId).trim(),
            origin: {
              type: "workflow_node",
              workflowRunId,
              workflowNodeExecutionId: nodeExecutionId,
            },
            nodeExecutionId,
            commandId: nodeCommandId,
            dialogProcessId: nodeDialogProcessId,
            nodeId: resolvedNodeIdentity.nodeId,
            nodeName: resolvedNodeIdentity.nodeName,
            transition: Number(transition || 0),
            turnScopeId: nodeTurnScopeId,
            workflowSessionId: String(ctx?.sessionId || "").trim(),
            workflowDialogProcessId: nodeDialogProcessId,
            upstreamWorkflowNodeResults: upstreamNodeResults,
          },
        }));
      try {
        subSession = await withTimeout(
          subSessionRunPromise,
          nodeAgentTimeoutMs,
          `workflow node sub-session timeout (${nodeAgentTimeoutMs}ms)`,
          { signal: resolveWorkflowAbortSignal(ctx) },
        );
      } catch (error) {
        if (isWorkflowAbortError(error, ctx)) {
          await Promise.allSettled([subSessionRunPromise]);
        }
        throw error;
      }
      throwIfWorkflowAborted(ctx);
    } catch (error) {
      if (isWorkflowAbortError(error, ctx)) {
        throw error;
      }
      const failureMessage = String(error?.message || error || "workflow node sub-session failed").trim();
      subSessionFailure = {
        source: "workflow_node_agent",
        code: String(error?.code || "WORKFLOW_NODE_SUBSESSION_FAILED").trim(),
        message: failureMessage,
      };
      if (error?.lifecycle && typeof error.lifecycle === "object") {
        subSession = { lifecycle: error.lifecycle };
      }
      if (!subSession) subSession = null;
    }
    if (subSession) {
      throwIfWorkflowAborted(ctx);
      await persistWorkflowNodeResultAttachment({
        options,
        ctx,
        subSession,
        pendingStep,
        transition,
        nodeIdentity: {
          ...resolvedNodeIdentity,
          sessionId: String(subSession?.sessionId || "").trim(),
        },
      });
    }
  }
  throwIfWorkflowAborted(ctx);
  if (subSessionFailure) {
    return {
      action: {
        type: WORKFLOW_ACTION.SUBMIT,
        stepIndex: Number(pendingStep?.index || 0),
        stepFailure: subSessionFailure,
      },
      subSession,
      nodeDialogProcessId,
      nodeIdentity: resolvedNodeIdentity,
      status: "failed",
      stepFailure: subSessionFailure,
    };
  }
  if (typeof options?.nodeAgentExecutor === "function") {
    const directAction = await options.nodeAgentExecutor(hookPayload);
    throwIfWorkflowAborted(ctx);
    if (directAction && typeof directAction === "object") {
      return {
        action: directAction,
        subSession,
        nodeDialogProcessId,
        nodeIdentity: {
          ...resolvedNodeIdentity,
          sessionId: String(subSession?.sessionId || "").trim(),
        },
      };
    }
  }
  const emitResult = await hookManager.emit(HOOK_POINT.WORKFLOW.NODE_AGENT_EXECUTE, hookPayload);
  throwIfWorkflowAborted(ctx);
  for (const outcome of emitResult.outcomes) {
    const action = outcome?.value?.action;
    if (action && typeof action === "object") {
      return {
        action,
        subSession,
        nodeDialogProcessId,
        nodeIdentity: {
          ...resolvedNodeIdentity,
          sessionId: String(subSession?.sessionId || "").trim(),
        },
      };
    }
  }
  return {
    action: { type: WORKFLOW_ACTION.SUBMIT, stepIndex: Number(pendingStep?.index || 0) },
    subSession,
    nodeDialogProcessId,
    nodeIdentity: {
      ...resolvedNodeIdentity,
      sessionId: String(subSession?.sessionId || "").trim(),
    },
  };
}

export function buildPendingStepKey(step = {}) {
  return `${String(step?.nodeName || "").trim()}::${Number(step?.nodeType || 0)}`;
}

export function resolveStepIndexForAction({
  snapshot = {},
  preferredIndex = 0,
  pendingStep = {},
} = {}) {
  const pendingSteps = Array.isArray(snapshot?.pendingSteps) ? snapshot.pendingSteps : [];
  if (!pendingSteps.length) return 0;
  const key = buildPendingStepKey(pendingStep);
  const matchedIndex = pendingSteps.findIndex((item) => buildPendingStepKey(item) === key);
  if (matchedIndex >= 0) return matchedIndex;
  const index = Number.isFinite(Number(preferredIndex)) ? Math.max(0, Math.floor(Number(preferredIndex))) : 0;
  return Math.min(index, Math.max(0, pendingSteps.length - 1));
}
