import {
  WORKFLOW_BOT_HOOK_POINTS,
  WORKFLOW_PHASE_STATUS,
  WORKFLOW_PHASES,
  WORKFLOW_PLUGIN_DEFAULTS,
  WORKFLOW_RETRY,
  WORKFLOW_SEMANTIC,
  WORKFLOW_TRACE,
} from "./constants.js";
import { executeWorkflowText } from "../workflow/adapter.js";
import { buildWorkflowOrchestrationPayload } from "./orchestration-payload.js";

function resolveAssistantOutput(agentResult = {}) {
  const direct = String(agentResult?.output || agentResult?.answer || "").trim();
  if (direct) return direct;
  const messages = Array.isArray(agentResult?.turnMessages) ? agentResult.turnMessages : [];
  const last = messages[messages.length - 1];
  return String(last?.content || "").trim();
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
  const result = await options.capabilityModelInvoker({
    purpose: WORKFLOW_SEMANTIC.PURPOSE,
    domain: WORKFLOW_SEMANTIC.DOMAIN,
    model: options?.semanticModel || "",
    locale,
    prompt: options?.semanticPrompt || "",
    messages: [
      {
        role: "user",
        content: `用户输入:\n${userMessage || "(empty)"}\n\n主模型回复:\n${sourceText || "(empty)"}`,
      },
    ],
    ctx,
  });
  const resolvedText = String(result?.content || result?.output || "").trim() || sourceText;
  return {
    text: resolvedText,
    invoked: true,
    model: String(options?.semanticModel || "").trim(),
    traceCount: Array.isArray(result?.traces) ? result.traces.length : 0,
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

export function createRegisterWorkflowHooks() {
  return function registerWorkflowHooks({ hookManager, options }) {
    const disposers = [];

    disposers.push(
      hookManager.on(
        WORKFLOW_BOT_HOOK_POINTS.AFTER_AGENT_DISPATCH,
        async (ctx = {}) => {
          const agentResult = ctx?.agentResult && typeof ctx.agentResult === "object" ? ctx.agentResult : {};
          const phaseTracker = createPhaseTracker();
          const retryMeta = {
            maxAttempts: WORKFLOW_RETRY.MAX_ATTEMPTS,
            attempts: WORKFLOW_RETRY.MAX_ATTEMPTS,
            history: [],
          };
          phaseTracker.start(WORKFLOW_PHASES.HOOK_RECEIVED);
          const sourceText = resolveAssistantOutput(agentResult);
          if (!sourceText) {
            phaseTracker.end(WORKFLOW_PHASES.HOOK_RECEIVED, WORKFLOW_PHASE_STATUS.SKIPPED, {
              reason: "empty_source_text",
            });
            return;
          }
          phaseTracker.end(WORKFLOW_PHASES.HOOK_RECEIVED, WORKFLOW_PHASE_STATUS.SUCCEEDED, {
            sourceTextLength: sourceText.length,
          });

          try {
            phaseTracker.start(WORKFLOW_PHASES.SEMANTIC_RESOLUTION);
            const semanticResolution = await resolveSemanticText({ options, ctx, sourceText });
            phaseTracker.end(
              WORKFLOW_PHASES.SEMANTIC_RESOLUTION,
              WORKFLOW_PHASE_STATUS.SUCCEEDED,
              {
              invoked: semanticResolution?.invoked === true,
              traceCount: Number(semanticResolution?.traceCount || 0),
              },
            );
            const semanticText = String(semanticResolution?.text || "").trim();
            phaseTracker.start(WORKFLOW_PHASES.WORKFLOW_EXECUTION);
            const { semantic, execution } = executeWorkflowText({
              semanticText,
              options,
            });
            phaseTracker.end(
              WORKFLOW_PHASES.WORKFLOW_EXECUTION,
              WORKFLOW_PHASE_STATUS.SUCCEEDED,
              {
              completed: execution?.completed === true,
              pendingStepCount: Number(execution?.pendingStepCount || 0),
              },
            );
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

            agentResult.workflow = workflowPayload;
            appendWorkflowTrace(agentResult, {
              stage: WORKFLOW_TRACE.STAGE_EXECUTED,
              interactionId: workflowPayload.interactionId,
              protocolVersion: workflowPayload.protocolVersion,
              completed: execution?.completed === true,
              pendingStepCount: execution?.pendingStepCount ?? 0,
              autoTransitions: execution?.autoTransitions ?? 0,
            });
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
          }
        },
        {
          id: "workflow_after_agent_dispatch",
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
