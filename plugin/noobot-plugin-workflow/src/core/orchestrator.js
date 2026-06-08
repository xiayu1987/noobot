/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

import {
  WORKFLOW_ACTION,
  WORKFLOW_BOT_HOOK_POINTS,
  WORKFLOW_HOOKS,
  WORKFLOW_PHASE_STATUS,
  WORKFLOW_PHASES,
  WORKFLOW_PLUGIN_DEFAULTS,
  WORKFLOW_RETRY,
  WORKFLOW_SEMANTIC,
  WORKFLOW_TRACE,
} from "./constants.js";
import { cleanupWorkflowBySessionIds } from "../utils/cleanup.js";
import {
  advanceWorkflowInstance,
  createWorkflowInstance,
  executeWorkflowText,
  releaseWorkflowInstance,
  resolveWorkflowUpstreamActionSteps,
} from "../workflow/adapter.js";
import {
  isWorkflowAbortError,
  resolveWorkflowAbortSignal,
  throwIfWorkflowAborted,
} from "./hooks/runtime.js";
import {
  getWorkflowTransferPayloadFromResult,
  mergeAttachmentMetas,
  normalizeWorkflowTransferPayload,
  resolveAttachmentDisplayPath,
  resolveWorkflowAttachmentMetasFromTransferPayload,
  resolveWorkflowInputAttachmentMetas,
} from "./hooks/attachments.js";
import {
  buildWorkflowAvailableToolsPlanningBlock,
  resolveWorkflowAvailableToolNames,
  resolveWorkflowSemanticContextMessages,
  resolveWorkflowSourceText,
} from "./hooks/messages.js";
import { appendWorkflowTrace, createPhaseTracker } from "./hooks/phase.js";
import {
  buildWorkflowUpstreamAttachmentResults,
  resolveSemanticNodeForPendingStep,
  resolveStepIndexForAction,
  resolveWorkflowInstanceId,
  runNodeAgent,
} from "./hooks/node-agent.js";
import {
  appendWorkflowPlanningMessage,
  emitWorkflowRuntimeEvent,
  persistWorkflowPlanningDialog,
  resolveSubSessionFinalOutput,
  stripHarnessReviewAppendix,
  truncateWorkflowResultText,
} from "./hooks/persistence.js";
import { buildWorkflowOrchestrationPayload } from "./orchestration-payload.js";
import { resolveWorkflowLocaleFromContext, tWorkflow } from "./i18n.js";

function buildWorkflowInputAttachmentPlanningBlock(attachmentMetas = [], ctx = {}) {
  const locale = resolveWorkflowLocaleFromContext(ctx);
  const lines = (Array.isArray(attachmentMetas) ? attachmentMetas : [])
    .map((item = {}, index) => {
      const attachmentId = String(item?.attachmentId || item?.id || "").trim();
      const name = String(
        item?.name ||
          item?.fileName ||
          tWorkflow(locale, "workflowAttachmentDefaultLabel", { index: index + 1 }),
      ).trim();
      const mimeType = String(item?.mimeType || "").trim();
      const path = resolveAttachmentDisplayPath(item, ctx);
      const parts = [
        attachmentId ? `attachmentId=${attachmentId}` : "",
        name ? `name=${name}` : "",
        mimeType ? `mimeType=${mimeType}` : "",
        path ? `path=${path}` : "",
      ].filter(Boolean);
      return parts.length ? `- ${parts.join("; ")}` : "";
    })
    .filter(Boolean);
  if (!lines.length) return "";
  return [
    tWorkflow(locale, "workflowInputAttachmentsHeader"),
    ...lines,
    "",
    tWorkflow(locale, "workflowInputAttachmentsPlanHint1"),
    tWorkflow(locale, "workflowInputAttachmentsPlanHint2"),
    tWorkflow(locale, "workflowInputAttachmentsPlanHint3"),
    tWorkflow(locale, "workflowInputAttachmentsPlanHint4"),
  ].join("\n");
}

async function resolveSemanticText({ options = {}, ctx = {}, sourceText = "" } = {}) {
  throwIfWorkflowAborted(ctx);
  if (typeof options?.capabilityModelInvoker !== "function") {
    return {
      text: sourceText,
      invoked: false,
      model: "",
      traceCount: 0,
    };
  }
  const userMessage = String(ctx?.userMessage || "").trim();
  const locale = String(ctx?.runConfig?.locale || WORKFLOW_PLUGIN_DEFAULTS.DEFAULT_LOCALE).trim();
  const userAttachmentMetas = resolveWorkflowInputAttachmentMetas(ctx);
  const attachmentPlanningBlock = buildWorkflowInputAttachmentPlanningBlock(userAttachmentMetas, ctx);
  const availableToolNames = resolveWorkflowAvailableToolNames(ctx);
  const availableToolsPlanningBlock = buildWorkflowAvailableToolsPlanningBlock(ctx, locale);
  const contextMessages = resolveWorkflowSemanticContextMessages({ options, ctx, locale });
  const availableToolsSystemMessage = String(availableToolsPlanningBlock || "").trim()
    ? { role: "system", content: availableToolsPlanningBlock }
    : null;
  const semanticTaskMessage = {
    role: "user",
    content: [
      tWorkflow(locale, "workflowSemanticPlanByContext"),
      tWorkflow(locale, "workflowSemanticCurrentUserMessage", {
        message: userMessage || tWorkflow(locale, "workflowSemanticEmpty"),
      }),
      attachmentPlanningBlock,
      tWorkflow(locale, "workflowSemanticSourceInput", {
        source: sourceText || tWorkflow(locale, "workflowSemanticEmpty"),
      }),
    ]
      .map((item) => String(item || "").trim())
      .filter(Boolean)
      .join("\n\n"),
  };
  const semanticMessages = [
    ...contextMessages,
    ...(availableToolsSystemMessage ? [availableToolsSystemMessage] : []),
    semanticTaskMessage,
  ];
  const result = await options.capabilityModelInvoker({
    purpose: WORKFLOW_SEMANTIC.PURPOSE,
    domain: WORKFLOW_SEMANTIC.DOMAIN,
    model: options?.semanticModel || "",
    locale,
    prompt: options?.semanticPrompt || "",
    messages: semanticMessages,
    ctx,
    toolAllowlist: availableToolNames,
    signal: resolveWorkflowAbortSignal(ctx),
  });
  throwIfWorkflowAborted(ctx);
  const resolvedText = String(result?.content || result?.output || "").trim() || sourceText;
  return {
    text: resolvedText,
    invoked: true,
    model: String(options?.semanticModel || "").trim(),
    traceCount: Array.isArray(result?.traces) ? result.traces.length : 0,
    requestMessages: semanticMessages,
    toolAllowlist: availableToolNames,
  };
}

export function createRegisterWorkflowHooks() {
  return function registerWorkflowHooks({ hookManager, options }) {
    const disposers = [];
    const hookPoint = WORKFLOW_BOT_HOOK_POINTS.BEFORE_AGENT_DISPATCH;
    const sessionCleanupPoint = WORKFLOW_BOT_HOOK_POINTS.AFTER_SESSION_DELETE;

    disposers.push(
      hookManager.on(
        hookPoint,
        async (ctx = {}) => {
          const beforeDispatchMode =
            String(hookPoint || "").trim() === WORKFLOW_BOT_HOOK_POINTS.BEFORE_AGENT_DISPATCH;
          const sourceAgentResult =
            ctx?.agentResult && typeof ctx.agentResult === "object" ? ctx.agentResult : {};
          const agentResult = beforeDispatchMode
            ? { output: "", traces: [], turnMessages: [] }
            : sourceAgentResult;
          const phaseTracker = createPhaseTracker();
          const retryMeta = {
            maxAttempts: WORKFLOW_RETRY.MAX_ATTEMPTS,
            attempts: WORKFLOW_RETRY.MAX_ATTEMPTS,
            history: [],
          };
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
            const planningWorkflowPayload = buildWorkflowOrchestrationPayload({
              ctx,
              options,
              sourceText,
              semanticText,
              semantic,
              execution: {
                started: false,
                instanceId: "",
                autoTransitions: 0,
                completed: false,
                pendingStepCount: 0,
                actionRecords: [],
                nodeAgentRuns: [],
              },
              semanticResolution,
              phaseTimeline: phaseTracker.list(),
              retryMeta,
            });
            planningWorkflowPayload.planningDialog = {
              dialogId: String(ctx?.dialogProcessId || "").trim(),
              sessionId: String(ctx?.sessionId || "").trim(),
              storagePath: String(planningPersistResult?.outputDir || "").trim(),
              storageFile: String(planningPersistResult?.outputFile || "").trim(),
            };
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
            phaseTracker.start(WORKFLOW_PHASES.WORKFLOW_EXECUTION);
            throwIfWorkflowAborted(ctx);
            await emitWorkflowRuntimeEvent({
              options,
              ctx,
              event: "workflow_execution_started",
            });
            const instanceId = resolveWorkflowInstanceId(ctx);
            let snapshot = createWorkflowInstance({
              instanceId,
              semantic,
              options,
              meta: {
                userId: String(ctx?.userId || "").trim(),
                sessionId: String(ctx?.sessionId || "").trim(),
                dialogProcessId: String(ctx?.dialogProcessId || "").trim(),
              },
            });
            const maxTransitions = Number.isFinite(Number(options?.maxAutoTransitions))
              ? Math.max(1, Math.floor(Number(options.maxAutoTransitions)))
              : WORKFLOW_PLUGIN_DEFAULTS.DEFAULT_MAX_AUTO_TRANSITIONS;
            const maxParallelNodeAgents = Number.isFinite(Number(options?.maxParallelNodeAgents))
              ? Math.max(1, Math.floor(Number(options.maxParallelNodeAgents)))
              : WORKFLOW_PLUGIN_DEFAULTS.DEFAULT_MAX_PARALLEL_NODE_AGENTS;
            const parallelEnabled = options?.parallelNodeExecution === true;
            const nodeAgentRuns = [];
            const completedStepResults = new Map();
            let transitions = 0;
            while (snapshot && snapshot.completed !== true && transitions < maxTransitions) {
              throwIfWorkflowAborted(ctx);
              const pending = Array.isArray(snapshot.pendingSteps) ? snapshot.pendingSteps : [];
              if (!pending.length) break;
              const waveSize = parallelEnabled ? Math.min(maxParallelNodeAgents, pending.length) : 1;
              const waveSteps = pending.slice(0, waveSize);
              const waveResults = await Promise.all(
                waveSteps.map(async (step, idx) => {
                  throwIfWorkflowAborted(ctx);
                  const upstreamActionSteps = resolveWorkflowUpstreamActionSteps({
                    instanceId,
                    pendingStep: step,
                  });
                  const upstreamNodeResults = buildWorkflowUpstreamAttachmentResults({
                    upstreamActionSteps,
                    completedStepResults,
                  });
                  const action = await runNodeAgent({
                    hookManager,
                    options,
                    ctx,
                    instanceId,
                    pendingStep: step,
                    semantic,
                    transition: transitions + idx + 1,
                    upstreamNodeResults,
                  });
                  throwIfWorkflowAborted(ctx);
                  return {
                    step,
                    action: action?.action || null,
                    subSession: action?.subSession || null,
                    nodeDialogId: String(action?.nodeDialogId || "").trim(),
                    upstreamNodeResults,
                    order: idx,
                  };
                }),
              );
              throwIfWorkflowAborted(ctx);
              // 先执行高 index，尽量保持并发批次中的原始 stepIndex 语义。
              const actionQueue = waveResults
                .slice()
                .sort((a, b) => Number(b?.step?.index || 0) - Number(a?.step?.index || 0));
              for (const item of actionQueue) {
                throwIfWorkflowAborted(ctx);
                if (!snapshot || snapshot.completed === true || transitions >= maxTransitions) break;
                const resolvedStepIndex = resolveStepIndexForAction({
                  snapshot,
                  preferredIndex: item?.action?.stepIndex ?? item?.step?.index ?? 0,
                  pendingStep: item?.step || {},
                });
                const effectiveAction = {
                  type: String(item?.action?.type || WORKFLOW_ACTION.SUBMIT).trim().toLowerCase(),
                  stepIndex: resolvedStepIndex,
                  ...(item?.action?.stepFailure && typeof item.action.stepFailure === "object"
                    ? { stepFailure: item.action.stepFailure }
                    : {}),
                };
                snapshot = advanceWorkflowInstance({
                  instanceId,
                  action: effectiveAction,
                });
                transitions += 1;
                nodeAgentRuns.push({
                  transition: transitions,
                  step: item?.step || null,
                  action: effectiveAction,
                  nodeDialogId: String(item?.nodeDialogId || "").trim(),
                  nodeSessionId: String(item?.subSession?.sessionId || "").trim(),
                  nodeSessionPersistedPath: String(item?.subSession?.persisted?.outputDir || "").trim(),
                  actionNodeStateId: String(item?.step?.actionNodeStateId || "").trim(),
                  stepId: String(item?.step?.stepId || "").trim(),
                  stepIndex: Number.isFinite(Number(item?.step?.stepIndex))
                    ? Number(item.step.stepIndex)
                    : -1,
                  nodeResultText: truncateWorkflowResultText(
                    stripHarnessReviewAppendix(
                      resolveSubSessionFinalOutput(item?.subSession || {}),
                    ),
                    4000,
                  ),
                  nodeResultAttachmentMetas: (() => {
                    const transferMetas = resolveWorkflowAttachmentMetasFromTransferPayload(
                      getWorkflowTransferPayloadFromResult(item?.subSession?.result || {}),
                      ctx,
                    );
                    if (transferMetas.length) return transferMetas;
                    return Array.isArray(item?.subSession?.result?.attachmentMetas)
                      ? item.subSession.result.attachmentMetas
                      : [];
                  })(),
                  nodeResultTransferEnvelope: getWorkflowTransferPayloadFromResult(item?.subSession?.result || {}).transferEnvelope,
                  nodeResultTransferEnvelopes: getWorkflowTransferPayloadFromResult(item?.subSession?.result || {}).transferEnvelopes,
                  nodeResultTransferResult: getWorkflowTransferPayloadFromResult(item?.subSession?.result || {}).transferResult,
                  stepStatus: item?.action?.stepFailure ? "failed" : "",
                  stepFailure:
                    item?.action?.stepFailure && typeof item.action.stepFailure === "object"
                      ? item.action.stepFailure
                      : null,
                  upstreamNodeResults: Array.isArray(item?.upstreamNodeResults)
                    ? item.upstreamNodeResults
                    : [],
                  parallelWave: parallelEnabled ? Math.floor((transitions - 1) / Math.max(1, waveSize)) + 1 : 0,
                  waveOrder: Number(item?.order ?? 0),
                  pendingStepCount: Number(snapshot?.pendingStepCount || 0),
                });
                const completedSemanticNode = resolveSemanticNodeForPendingStep({
                  semantic,
                  pendingStep: item?.step || {},
                });
                const completedStepId = String(item?.step?.stepId || "").trim();
                const completedNodeId = String(
                  item?.step?.nodeId || completedSemanticNode?.id || "",
                ).trim();
                const completedNodeTask = String(
                  item?.step?.nodeTask ||
                    completedSemanticNode?.task ||
                    completedSemanticNode?.taskText ||
                    completedSemanticNode?.instruction ||
                    completedSemanticNode?.mission ||
                    "",
                ).trim();
                if (completedStepId) {
                  const resultTransferPayload = getWorkflowTransferPayloadFromResult(item?.subSession?.result || {});
                  completedStepResults.set(completedStepId, {
                    transition: transitions,
                    nodeId: completedNodeId,
                    nodeName: String(
                      item?.step?.nodeName || completedSemanticNode?.name || completedNodeId,
                    ).trim(),
                    nodeTask: completedNodeTask,
                    actionNodeStateId: String(item?.step?.actionNodeStateId || "").trim(),
                    stepId: completedStepId,
                    stepIndex: Number.isFinite(Number(item?.step?.stepIndex))
                      ? Number(item.step.stepIndex)
                      : -1,
                    nodeDialogId: String(item?.nodeDialogId || "").trim(),
                    nodeSessionId: String(item?.subSession?.sessionId || "").trim(),
                    stepStatus: item?.action?.stepFailure ? "failed" : "",
                    stepFailure:
                      item?.action?.stepFailure && typeof item.action.stepFailure === "object"
                        ? item.action.stepFailure
                        : null,
                    attachmentMetas: (() => {
                      const transferMetas = resolveWorkflowAttachmentMetasFromTransferPayload(
                        resultTransferPayload,
                        ctx,
                      );
                      if (transferMetas.length) return transferMetas;
                      return Array.isArray(item?.subSession?.result?.attachmentMetas)
                        ? item.subSession.result.attachmentMetas
                        : [];
                    })(),
                    transferEnvelope: resultTransferPayload.transferEnvelope,
                    transferEnvelopes: resultTransferPayload.transferEnvelopes,
                    transferResult: resultTransferPayload.transferResult,
                  });
                }
              }
            }
            throwIfWorkflowAborted(ctx);
            const execution = {
              started: true,
              instanceId,
              autoTransitions: transitions,
              completed: snapshot?.completed === true,
              pendingStepCount: Number(snapshot?.pendingStepCount || 0),
              actionRecords: Array.isArray(snapshot?.actionRecords) ? snapshot.actionRecords : [],
              nodeAgentRuns,
            };
            if (execution.completed) {
              releaseWorkflowInstance({ instanceId });
            }
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
            workflowPayload.planningDialog = {
              dialogId: String(ctx?.dialogProcessId || "").trim(),
              sessionId: String(ctx?.sessionId || "").trim(),
              storagePath: String(planningPersistResult?.outputDir || "").trim(),
              storageFile: String(planningPersistResult?.outputFile || "").trim(),
            };
            workflowPayload.nodeSessions = nodeAgentRuns
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
                  attachmentMetas: Array.isArray(item?.nodeResultAttachmentMetas)
                    ? item.nodeResultAttachmentMetas
                    : [],
                  transferEnvelope:
                    item?.nodeResultTransferEnvelope && typeof item.nodeResultTransferEnvelope === "object"
                      ? item.nodeResultTransferEnvelope
                      : null,
                  transferEnvelopes: Array.isArray(item?.nodeResultTransferEnvelopes)
                    ? item.nodeResultTransferEnvelopes
                    : item?.nodeResultTransferEnvelope && typeof item.nodeResultTransferEnvelope === "object"
                      ? [item.nodeResultTransferEnvelope]
                      : [],
                  ...(item?.nodeResultTransferResult && typeof item.nodeResultTransferResult === "object"
                    ? { transferResult: item.nodeResultTransferResult }
                    : {}),
                  stepStatus: String(item?.stepStatus || "").trim(),
                  stepFailure:
                    item?.stepFailure && typeof item.stepFailure === "object"
                      ? item.stepFailure
                      : null,
                  parallelWave: Number(item?.parallelWave || 0),
                  waveOrder: Number(item?.waveOrder || 0),
                };
              })
              .filter((item) => item.dialogId || item.sessionId);
            const workflowAttachmentMetas = nodeAgentRuns.reduce((acc, item = {}) => {
              const transferPayload = normalizeWorkflowTransferPayload({
                transferResult: item?.nodeResultTransferResult || null,
                transferEnvelope: item?.nodeResultTransferEnvelope || null,
                transferEnvelopes: item?.nodeResultTransferEnvelopes || [],
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
            workflowPayload.transferEnvelopes = nodeAgentRuns.flatMap((item = {}) => {
              if (Array.isArray(item?.nodeResultTransferEnvelopes) && item.nodeResultTransferEnvelopes.length) {
                return item.nodeResultTransferEnvelopes;
              }
              return item?.nodeResultTransferEnvelope && typeof item.nodeResultTransferEnvelope === "object"
                ? [item.nodeResultTransferEnvelope]
                : [];
            });
            workflowPayload.transferEnvelope = workflowPayload.transferEnvelopes[0] || null;
            // Legacy mirror field for existing consumers; transfer* remains canonical.
            workflowPayload.attachmentMetas = workflowAttachmentMetas;

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
        },
        {
          id: WORKFLOW_HOOKS.AFTER_AGENT_DISPATCH_LISTENER_ID,
          priority: Number(options?.priority) || WORKFLOW_PLUGIN_DEFAULTS.DEFAULT_PRIORITY,
          timeoutMs:
            Number(options?.timeoutMs) > 0
              ? Number(options.timeoutMs)
              : WORKFLOW_PLUGIN_DEFAULTS.DEFAULT_TIMEOUT_MS,
        },
      ),
    );

    disposers.push(
      hookManager.on(
        sessionCleanupPoint,
        async (ctx = {}) => {
          const deletedSessionIds = Array.isArray(ctx?.deletedSessionIds)
            ? ctx.deletedSessionIds.map((id) => String(id || "").trim()).filter(Boolean)
            : [];
          const fallbackSessionId = String(ctx?.sessionId || "").trim();
          const sessionIds = deletedSessionIds.length
            ? deletedSessionIds
            : fallbackSessionId
              ? [fallbackSessionId]
              : [];
          if (!sessionIds.length) return;
          const basePath = String(ctx?.basePath || "").trim();
          if (!basePath) return;
          await cleanupWorkflowBySessionIds(basePath, sessionIds);
        },
        {
          id: WORKFLOW_HOOKS.AFTER_SESSION_DELETE_LISTENER_ID,
          priority: Number(options?.priority) || WORKFLOW_PLUGIN_DEFAULTS.DEFAULT_PRIORITY,
          timeoutMs:
            Number(options?.timeoutMs) > 0
              ? Number(options.timeoutMs)
              : WORKFLOW_PLUGIN_DEFAULTS.DEFAULT_TIMEOUT_MS,
        },
      ),
    );

    return disposers;
  };
}

export const registerWorkflowHooks = createRegisterWorkflowHooks();
