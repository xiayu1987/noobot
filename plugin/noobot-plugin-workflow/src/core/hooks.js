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
import {
  advanceWorkflowInstance,
  createWorkflowInstance,
  executeWorkflowText,
  releaseWorkflowInstance,
} from "../workflow/adapter.js";
import { buildWorkflowOrchestrationPayload } from "./orchestration-payload.js";

function resolveAssistantOutput(agentResult = {}) {
  const direct = String(agentResult?.output || agentResult?.answer || "").trim();
  if (direct) return direct;
  const messages = Array.isArray(agentResult?.turnMessages) ? agentResult.turnMessages : [];
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const messageItem = messages[index] || {};
    const content = String(messageItem?.content || "").trim();
    if (content) return content;
  }
  return "";
}

function resolveWorkflowSourceText(ctx = {}, agentResult = {}, hookPoint = "") {
  const normalizedHookPoint = String(hookPoint || "").trim();
  const outputFromAgent = resolveAssistantOutput(agentResult);
  if (outputFromAgent) return outputFromAgent;
  if (normalizedHookPoint === WORKFLOW_BOT_HOOK_POINTS.BEFORE_AGENT_DISPATCH) {
    return String(ctx?.userMessage || "").trim();
  }
  return String(ctx?.userMessage || "").trim();
}

function ensureTurnMessages(agentResult = {}) {
  const turnMessages = Array.isArray(agentResult?.turnMessages) ? agentResult.turnMessages : [];
  agentResult.turnMessages = turnMessages;
  return turnMessages;
}

function appendWorkflowPlanningMessage({
  options = {},
  agentResult = {},
  ctx = {},
  sourceText = "",
  semanticText = "",
  semanticResolution = {},
  workflowPayload = null,
} = {}) {
  const turnMessages = ensureTurnMessages(agentResult);
  turnMessages.push({
    role: "assistant",
    type: "workflow",
    content: semanticText || sourceText || "",
    dialogProcessId: String(ctx?.dialogProcessId || "").trim(),
    modelAlias: String(semanticResolution?.model || options?.semanticModel || "").trim(),
    modelName: String(semanticResolution?.model || options?.semanticModel || "").trim(),
    summarized: false,
    workflowMessage: true,
    workflowMeta: {
      source: "workflow-plugin",
      phase: "planning",
      semanticInvokerUsed: semanticResolution?.invoked === true,
      sourceTextPreview: String(sourceText || "").slice(0, 800),
      semanticTextPreview: String(semanticText || "").slice(0, 2000),
      payload:
        workflowPayload && typeof workflowPayload === "object"
          ? workflowPayload
          : null,
    },
  });
}

function buildWorkflowDialogRelativeDir({
  ctx = {},
  dialogProcessId = "",
  scope = "auto",
} = {}) {
  const sessionId = String(ctx?.sessionId || "").trim();
  const dialogId = String(dialogProcessId || ctx?.dialogProcessId || "").trim();
  if (!sessionId || !dialogId) return "";
  const normalizedScope = String(scope || "auto").trim().toLowerCase();
  if (normalizedScope === "planning") {
    return `runtime/workflow/planning/${sessionId}/${dialogId}`;
  }
  if (normalizedScope === "node") {
    return `runtime/workflow/session/${sessionId}/${dialogId}`;
  }
  const isNodeDialog = dialogId.startsWith("wf_node_");
  return isNodeDialog
    ? `runtime/workflow/session/${sessionId}/${dialogId}`
    : `runtime/workflow/planning/${sessionId}/${dialogId}`;
}

function buildWorkflowNodeInstruction(step = {}) {
  const taskText = String(
    step?.nodeTask ||
      step?.task ||
      step?.instruction ||
      step?.mission ||
      "",
  ).trim();
  if (taskText) return taskText;
  const nodeName = String(step?.nodeName || "").trim();
  if (nodeName) return `请处理任务：${nodeName}`;
  const nodeId = String(step?.nodeId || "").trim();
  if (nodeId) return `请处理节点任务：${nodeId}`;
  return "请处理当前任务。";
}

function resolveNodeTaskForPendingStep({ semantic = {}, pendingStep = {} } = {}) {
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

function withTimeout(promise, timeoutMs, message = "") {
  const ms = Number(timeoutMs);
  if (!Number.isFinite(ms) || ms <= 0) return promise;
  let timer = null;
  return Promise.race([
    Promise.resolve(promise).finally(() => {
      if (timer) clearTimeout(timer);
    }),
    new Promise((_, reject) => {
      timer = setTimeout(() => {
        const err = new Error(message || `workflow node timeout (${ms}ms)`);
        err.code = "WORKFLOW_NODE_TIMEOUT";
        reject(err);
      }, ms);
    }),
  ]);
}

async function emitWorkflowRuntimeEvent({
  options = {},
  ctx = {},
  dialogId = "",
  event = "",
  level = "info",
  data = {},
} = {}) {
  if (typeof options?.workflowEventLogger !== "function") return null;
  const userId = String(ctx?.userId || "").trim();
  if (!userId) return null;
  const resolvedDialogId = String(dialogId || ctx?.dialogProcessId || "").trim();
  const relativeDir = buildWorkflowDialogRelativeDir({
    ctx,
    dialogProcessId: resolvedDialogId,
  });
  if (!relativeDir) return null;
  try {
    return await options.workflowEventLogger({
      userId,
      relativeDir,
      fileName: "events.jsonl",
      event: {
        source: "workflow-plugin",
        level: String(level || "info").trim(),
        event: String(event || "").trim(),
        sessionId: String(ctx?.sessionId || "").trim(),
        dialogId: resolvedDialogId,
        ...(data && typeof data === "object" ? data : {}),
      },
    });
  } catch {
    return null;
  }
}

async function persistWorkflowPlanningDialog({
  options = {},
  ctx = {},
  sourceText = "",
  semanticText = "",
  semanticResolution = {},
} = {}) {
  if (typeof options?.workflowDialogPersister !== "function") return null;
  const userId = String(ctx?.userId || "").trim();
  if (!userId) return null;
  const relativeDir = buildWorkflowDialogRelativeDir({
    ctx,
    dialogProcessId: String(ctx?.dialogProcessId || "").trim(),
    scope: "planning",
  });
  if (!relativeDir) return null;
  try {
    return await options.workflowDialogPersister({
      userId,
      relativeDir,
      fileName: "planning.json",
      payload: {
        scope: "workflow_planning",
        userId,
        sessionId: String(ctx?.sessionId || "").trim(),
        dialogId: String(ctx?.dialogProcessId || "").trim(),
        timestamp: new Date().toISOString(),
        sourceText,
        semanticText,
        semanticModel: String(options?.semanticModel || "").trim(),
        semanticPrompt: String(options?.semanticPrompt || "").trim(),
        semanticResolution: {
          invoked: semanticResolution?.invoked === true,
          traceCount: Number(semanticResolution?.traceCount || 0),
          requestMessages: Array.isArray(semanticResolution?.requestMessages)
            ? semanticResolution.requestMessages
            : [],
        },
      },
    });
  } catch {
    return null;
  }
}

async function resolveSemanticText({ options = {}, ctx = {}, sourceText = "" } = {}) {
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
  const semanticMessages = [
    {
      role: "user",
      content: `用户输入:\n${userMessage || "(empty)"}\n\n主模型回复:\n${sourceText || "(empty)"}`,
    },
  ];
  const result = await options.capabilityModelInvoker({
    purpose: WORKFLOW_SEMANTIC.PURPOSE,
    domain: WORKFLOW_SEMANTIC.DOMAIN,
    model: options?.semanticModel || "",
    locale,
    prompt: options?.semanticPrompt || "",
    messages: semanticMessages,
    ctx,
  });
  const resolvedText = String(result?.content || result?.output || "").trim() || sourceText;
  return {
    text: resolvedText,
    invoked: true,
    model: String(options?.semanticModel || "").trim(),
    traceCount: Array.isArray(result?.traces) ? result.traces.length : 0,
    requestMessages: semanticMessages,
  };
}

function appendWorkflowTrace(agentResult = {}, payload = {}) {
  const traces = Array.isArray(agentResult?.traces) ? agentResult.traces : [];
  traces.push({
    type: WORKFLOW_TRACE.TYPE,
    ...payload,
  });
  agentResult.traces = traces;
}

function createPhaseTracker() {
  const phases = [];
  return {
    start(name = "", meta = {}) {
      phases.push({
        phase: String(name || "").trim(),
        status: WORKFLOW_PHASE_STATUS.STARTED,
        startedAt: new Date().toISOString(),
        ...meta,
      });
    },
    end(name = "", status = WORKFLOW_PHASE_STATUS.SUCCEEDED, meta = {}) {
      const phaseName = String(name || "").trim();
      const now = new Date().toISOString();
      const openIdx = [...phases]
        .reverse()
        .findIndex(
          (item) =>
            item.phase === phaseName &&
            item.status === WORKFLOW_PHASE_STATUS.STARTED &&
            !item.endedAt,
        );
      if (openIdx >= 0) {
        const realIdx = phases.length - 1 - openIdx;
        phases[realIdx] = {
          ...phases[realIdx],
          status,
          endedAt: now,
          ...meta,
        };
      } else {
        phases.push({
          phase: phaseName,
          status,
          endedAt: now,
          ...meta,
        });
      }
    },
    list() {
      return phases.slice();
    },
  };
}

function resolveWorkflowInstanceId(ctx = {}) {
  const provided = String(
    ctx?.workflowInstanceId ||
      ctx?.runConfig?.workflowInstanceId ||
      "",
  ).trim();
  if (provided) return provided;
  const base = String(ctx?.dialogProcessId || ctx?.sessionId || "session").trim() || "session";
  return `wf_inst_${base}_${Date.now()}`;
}

async function runNodeAgent({
  hookManager,
  options = {},
  ctx = {},
  instanceId = "",
  pendingStep = {},
  semantic = {},
  transition = 0,
} = {}) {
  const nodeDialogId = `wf_node_${String(instanceId || "inst").replaceAll(/[^a-zA-Z0-9_-]/g, "_")}_${String(transition || 0)}`;
  await emitWorkflowRuntimeEvent({
    options,
    ctx,
    dialogId: nodeDialogId,
    event: "workflow_node_subsession_started",
    data: {
      instanceId: String(instanceId || "").trim(),
      transition: Number(transition || 0),
      nodeId: String(pendingStep?.nodeId || "").trim(),
      nodeName: String(pendingStep?.nodeName || "").trim(),
    },
  });
  const hookPayload = {
    ...ctx,
    workflow: {
      instanceId,
      pendingStep,
      transition,
      semantic,
    },
    agentInstruction: buildWorkflowNodeInstruction({
      ...pendingStep,
      nodeTask: resolveNodeTaskForPendingStep({ semantic, pendingStep }),
    }),
    proposedAction: { type: WORKFLOW_ACTION.SUBMIT, stepIndex: Number(pendingStep?.index || 0) },
  };
  let subSession = null;
  if (typeof options?.subSessionRunner === "function") {
    const parentRunConfig =
      ctx?.runConfig && typeof ctx.runConfig === "object" ? ctx.runConfig : {};
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
    const subSessionRunConfigPatch = parentHarnessEnabled
      ? {
          selectedPlugins: Array.from(new Set([...parentSelectedPlugins, "harness"])),
          plugins: {
            harness: {
              ...(parentHarness && typeof parentHarness === "object" ? parentHarness : {}),
              enabled: true,
              mode: "on",
            },
          },
        }
      : {};
    const relativeDir = buildWorkflowDialogRelativeDir({
      ctx,
      dialogProcessId: nodeDialogId,
      scope: "node",
    });
    try {
      const nodeAgentTimeoutMs = Number.isFinite(Number(options?.nodeAgentTimeoutMs))
        ? Math.max(1000, Math.floor(Number(options.nodeAgentTimeoutMs)))
        : WORKFLOW_PLUGIN_DEFAULTS.DEFAULT_NODE_AGENT_TIMEOUT_MS;
      subSession = await withTimeout(
        options.subSessionRunner({
          parentContext: ctx,
          message: hookPayload.agentInstruction,
          runConfigPatch: subSessionRunConfigPatch,
          eventListener:
            ctx?.eventListener && typeof ctx.eventListener?.onEvent === "function"
              ? ctx.eventListener
              : null,
          strategy: {
            parentSessionId: String(ctx?.sessionId || "").trim(),
            parentDialogProcessId: String(ctx?.dialogProcessId || "").trim(),
            dialogProcessId: nodeDialogId,
            disabledPlugins: ["workflow"],
            relativeDir,
          },
          metadata: {
            scope: "workflow_node",
            instanceId: String(instanceId || "").trim(),
            nodeId: String(pendingStep?.nodeId || "").trim(),
            nodeName: String(pendingStep?.nodeName || "").trim(),
            transition: Number(transition || 0),
            workflowSessionId: String(ctx?.sessionId || "").trim(),
            workflowDialogId: nodeDialogId,
          },
        }),
        nodeAgentTimeoutMs,
        `workflow node sub-session timeout (${nodeAgentTimeoutMs}ms)`,
      );
      await emitWorkflowRuntimeEvent({
        options,
        ctx,
        dialogId: nodeDialogId,
        event: "workflow_node_subsession_succeeded",
        data: {
          instanceId: String(instanceId || "").trim(),
          nodeSessionId: String(subSession?.sessionId || "").trim(),
          persistedDir: String(subSession?.persisted?.outputDir || "").trim(),
        },
      });
    } catch {
      await emitWorkflowRuntimeEvent({
        options,
        ctx,
        dialogId: nodeDialogId,
        event: "workflow_node_subsession_failed",
        level: "error",
        data: {
          instanceId: String(instanceId || "").trim(),
          nodeId: String(pendingStep?.nodeId || "").trim(),
        },
      });
      subSession = null;
    }
  }
  if (typeof options?.nodeAgentExecutor === "function") {
    const directAction = await options.nodeAgentExecutor(hookPayload);
    if (directAction && typeof directAction === "object") {
      return {
        action: directAction,
        subSession,
        nodeDialogId,
      };
    }
  }
  const emitResult = await hookManager.emit(WORKFLOW_BOT_HOOK_POINTS.NODE_AGENT_EXECUTE, hookPayload);
  const results = Array.isArray(emitResult?.results) ? emitResult.results : [];
  for (const item of results) {
    if (!item?.ok) continue;
    const action = item?.result?.action;
    if (action && typeof action === "object") {
      return {
        action,
        subSession,
        nodeDialogId,
      };
    }
  }
  return {
    action: { type: WORKFLOW_ACTION.SUBMIT, stepIndex: Number(pendingStep?.index || 0) },
    subSession,
    nodeDialogId,
  };
}

function buildPendingStepKey(step = {}) {
  return `${String(step?.nodeName || "").trim()}::${Number(step?.nodeType || 0)}`;
}

function resolveStepIndexForAction({
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

export function createRegisterWorkflowHooks() {
  return function registerWorkflowHooks({ hookManager, options }) {
    const disposers = [];
    const hookPoint = WORKFLOW_BOT_HOOK_POINTS.BEFORE_AGENT_DISPATCH;

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

          try {
            phaseTracker.start(WORKFLOW_PHASES.SEMANTIC_RESOLUTION);
            await emitWorkflowRuntimeEvent({
              options,
              ctx,
              event: "workflow_semantic_resolution_started",
            });
            const semanticResolution = await resolveSemanticText({ options, ctx, sourceText });
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
            phaseTracker.start(WORKFLOW_PHASES.WORKFLOW_EXECUTION);
            await emitWorkflowRuntimeEvent({
              options,
              ctx,
              event: "workflow_execution_started",
            });
            const { semantic } = executeWorkflowText({
              semanticText,
              options,
            });
            const instanceId = resolveWorkflowInstanceId(ctx);
            const conditionContext =
              ctx?.runConfig?.workflowConditionContext &&
              typeof ctx.runConfig.workflowConditionContext === "object"
                ? ctx.runConfig.workflowConditionContext
                : ctx?.workflowConditionContext && typeof ctx.workflowConditionContext === "object"
                  ? ctx.workflowConditionContext
                  : null;
            const effectiveOptions = conditionContext
              ? {
                  ...options,
                  conditionContext,
                }
              : options;
            let snapshot = createWorkflowInstance({
              instanceId,
              semantic,
              options: effectiveOptions,
              meta: {
                userId: String(ctx?.userId || "").trim(),
                sessionId: String(ctx?.sessionId || "").trim(),
                dialogProcessId: String(ctx?.dialogProcessId || "").trim(),
                ...(conditionContext ? { conditionContext } : {}),
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
            let transitions = 0;
            while (snapshot && snapshot.completed !== true && transitions < maxTransitions) {
              const pending = Array.isArray(snapshot.pendingSteps) ? snapshot.pendingSteps : [];
              if (!pending.length) break;
              const waveSize = parallelEnabled ? Math.min(maxParallelNodeAgents, pending.length) : 1;
              const waveSteps = pending.slice(0, waveSize);
              const waveResults = await Promise.all(
                waveSteps.map(async (step, idx) => {
                  const action = await runNodeAgent({
                    hookManager,
                    options,
                    ctx,
                    instanceId,
                    pendingStep: step,
                    semantic,
                    transition: transitions + idx + 1,
                  });
                  return {
                    step,
                    action: action?.action || null,
                    subSession: action?.subSession || null,
                    nodeDialogId: String(action?.nodeDialogId || "").trim(),
                    order: idx,
                  };
                }),
              );
              // 先执行高 index，尽量保持并发批次中的原始 stepIndex 语义。
              const actionQueue = waveResults
                .slice()
                .sort((a, b) => Number(b?.step?.index || 0) - Number(a?.step?.index || 0));
              for (const item of actionQueue) {
                if (!snapshot || snapshot.completed === true || transitions >= maxTransitions) break;
                const resolvedStepIndex = resolveStepIndexForAction({
                  snapshot,
                  preferredIndex: item?.action?.stepIndex ?? item?.step?.index ?? 0,
                  pendingStep: item?.step || {},
                });
                const effectiveAction = {
                  type: String(item?.action?.type || WORKFLOW_ACTION.SUBMIT).trim().toLowerCase(),
                  stepIndex: resolvedStepIndex,
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
                  parallelWave: parallelEnabled ? Math.floor((transitions - 1) / Math.max(1, waveSize)) + 1 : 0,
                  waveOrder: Number(item?.order ?? 0),
                  pendingStepCount: Number(snapshot?.pendingStepCount || 0),
                });
              }
            }
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
              .map((item = {}) => ({
                transition: Number(item?.transition || 0),
                nodeName: String(item?.step?.nodeName || "").trim(),
                nodeId: String(item?.step?.nodeId || "").trim(),
                rootSessionId: String(ctx?.sessionId || "").trim(),
                dialogId: String(item?.nodeDialogId || "").trim(),
                sessionId: String(item?.nodeSessionId || "").trim(),
                parallelWave: Number(item?.parallelWave || 0),
                waveOrder: Number(item?.waveOrder || 0),
              }))
              .filter((item) => item.dialogId || item.sessionId);

            agentResult.workflow = workflowPayload;
            appendWorkflowPlanningMessage({
              options,
              agentResult,
              ctx,
              sourceText,
              semanticText,
              semanticResolution,
              workflowPayload,
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

    return disposers;
  };
}

export const registerWorkflowHooks = createRegisterWorkflowHooks();
