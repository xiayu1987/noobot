/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { DynamicStructuredTool } from "@langchain/core/tools";
import { z } from "zod";
import {
  BUILTIN_THRESHOLDS,
  hasOwnConfigKey,
  mergeConfig,
  normalizeBooleanLike,
} from "../../config/index.js";
import {
  getRuntimeFromAgentContext,
  getSystemRuntimeFromRuntime,
  getChildRunParentSessionIdFromAgentContext,
} from "../../context/agent-context-accessor.js";
import { resolveContextMessageDialogProcessId } from "@noobot/context-protocol/message-codec";
import { recoverableToolError } from "../../shared/errors/index.js";
import { toToolJsonResult } from "../core/tool-json-result.js";
import { tTool } from "../core/tool-i18n.js";
import { isAbortError } from "../../shared/utils/error-utils.js";
import { createConnectorTools } from "./connector-toolkit.js";
import { ERROR_CODE } from "../../shared/errors/constants.js";
import { createAgentDetachedSubSessionStrategy } from "../../bot/session/detached-subsession-strategy.js";
import { TOOL_POLICY_MODE, TOOL_NAME, TOOL_RESULT_STATUS } from "../constants/index.js";

export function createConnectorAccessTool({ agentContext }) {
  const runtime = getRuntimeFromAgentContext(agentContext);
  const effectiveConfig = mergeConfig(runtime?.globalConfig || {}, runtime?.userConfig || {});
  const processConnectorTaskEnabled =
    effectiveConfig?.tools?.[TOOL_NAME.PROCESS_CONNECTOR_TOOL]?.enabled !== false;
  if (!processConnectorTaskEnabled) return [];

  const botManager = runtime?.botManager || null;
  const eventListener = runtime?.eventListener || null;
  const signal = runtime?.abortSignal || null;
  const userId = String(runtime?.userId || agentContext?.userId || "").trim();
  const systemRuntime = getSystemRuntimeFromRuntime(runtime);
  const sessionId = String(systemRuntime?.sessionId || "").trim();
  const parentSessionId = getChildRunParentSessionIdFromAgentContext(agentContext);
  const parentDialogProcessId = String(runtime?.systemRuntime?.dialogProcessId || "").trim();
  const allowUserInteraction = systemRuntime?.config?.allowUserInteraction !== false;
  const hasParentStreamingConfig = hasOwnConfigKey(systemRuntime?.config || {}, "streaming");
  const maxToolLoopTurns = BUILTIN_THRESHOLDS.subTasks.processConnectorToolMaxToolLoopTurns;
  const connectorSubSessionSystemPrompt = tTool(
    runtime,
    "tools.process_connector.subSessionSystemPrompt",
  );

  const processConnectorTaskTool = new DynamicStructuredTool({
    name: TOOL_NAME.PROCESS_CONNECTOR_TOOL,
    description: tTool(runtime, "tools.process_connector.description"),
    schema: z.object({
      task: z.string().describe(tTool(runtime, "tools.process_connector.fieldTask")),
      modelName: z
        .string()
        .optional()
        .describe(tTool(runtime, "tools.process_connector.fieldModelName")),
    }),
    func: async ({ task, modelName = "" }) => {
      const normalizedTask = String(task || "").trim();
      if (!normalizedTask) {
        throw recoverableToolError(tTool(runtime, "common.taskRequired"), {
          code: ERROR_CODE.RECOVERABLE_INPUT_MISSING,
        });
      }
      if (typeof botManager?.runDetachedSubSession !== "function" || !userId || !sessionId) {
        throw recoverableToolError(
          tTool(runtime, "common.runtimeMissingBotManagerUserIdSessionId"),
          {
            code: ERROR_CODE.RECOVERABLE_RUNTIME_CONTEXT_MISSING,
          },
        );
      }
      const subTools = [...createConnectorTools({ agentContext })];
      if (!subTools.length) {
        throw recoverableToolError(
          tTool(runtime, "tools.process_connector.errorToolsUnavailable"),
          {
            code: ERROR_CODE.RECOVERABLE_TOOLS_UNAVAILABLE,
          },
        );
      }
      try {
        const detachedRun = await botManager.runDetachedSubSession({
          parentExecutionScope: agentContext,
          message: normalizedTask,
          systemMessages: [connectorSubSessionSystemPrompt].filter(Boolean),
          eventListener,
          abortSignal: signal,
          strategy: createAgentDetachedSubSessionStrategy({
            userId,
            parentSessionId,
            parentDialogProcessId,
          }),
          metadata: {
            scope: TOOL_NAME.PROCESS_CONNECTOR_TOOL,
          },
          runConfigPatch: {
            pluginPolicy: { mode: "none" },
            allowUserInteraction,
            ...(hasParentStreamingConfig
              ? { streaming: normalizeBooleanLike(systemRuntime?.config?.streaming, false) }
              : {}),
            selectedConnectors:
              systemRuntime?.config?.selectedConnectors &&
              typeof systemRuntime.config.selectedConnectors === "object"
                ? systemRuntime.config.selectedConnectors
                : {},
            toolPolicy: {
              mode: TOOL_POLICY_MODE.CUSTOM_ONLY,
              customTools: subTools,
              forceIncludeUserInteraction: false,
            },
            ...(String(modelName || "").trim()
              ? { runtimeModel: String(modelName || "").trim() }
              : {}),
            maxToolLoopTurns:
              Number.isFinite(maxToolLoopTurns) && maxToolLoopTurns > 0
                ? Math.floor(maxToolLoopTurns)
                : 6,
            sharedTools:
              runtime?.sharedTools && typeof runtime.sharedTools === "object"
                ? runtime.sharedTools
                : {},
          },
        });
        const subSessionId = String(detachedRun?.sessionId || "").trim();
        const subResult = detachedRun?.result || {};
        const answer = String(subResult?.answer || "").trim();
        const traces = Array.isArray(subResult?.traces) ? subResult.traces : [];
        const transferEnvelopes = Array.isArray(subResult?.transferEnvelopes)
          ? subResult.transferEnvelopes
          : [];
        const usedTools = Array.from(
          new Set(traces.map((item) => String(item?.tool || "").trim()).filter(Boolean)),
        );
        return toToolJsonResult(
          TOOL_NAME.PROCESS_CONNECTOR_TOOL,
          {
            ok: true,
            status: TOOL_RESULT_STATUS.COMPLETED,
            sessionId: subSessionId,
            parentSessionId,
            answer,
            ...(transferEnvelopes.length ? { transferEnvelopes } : {}),
            tools: subTools.map((item) => item?.name).filter(Boolean),
            summary: {
              answer_length: answer.length,
              trace_count: traces.length,
              used_tools: usedTools,
              dialog_process_id: resolveContextMessageDialogProcessId(subResult),
            },
          },
          true,
        );
      } catch (error) {
        if (isAbortError(error)) throw error;
        throw recoverableToolError(error?.message || String(error), {
          code: String(error?.code || ERROR_CODE.RECOVERABLE_PROCESS_CONNECTOR_FAILED),
        });
      }
    },
  });

  return [processConnectorTaskTool];
}
