/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { DynamicStructuredTool } from "@langchain/core/tools";
import { z } from "zod";
import { randomUUID } from "node:crypto";
import { mergeConfig } from "../../config/index.js";
import { resolveMessageDialogProcessId } from "../../context/session/dialog-process-id-resolver.js";
import { recoverableToolError } from "../../error/index.js";
import { toToolJsonResult } from "../core/tool-json-result.js";
import { tTool } from "../core/tool-i18n.js";
import { isAbortError } from "../../utils/error-utils.js";
import { createConnectorTools } from "./connector-toolkit.js";
import { ERROR_CODE } from "../../error/constants.js";
import { resolveDialogProcessIdFromContext } from "../../context/session/dialog-process-id-resolver.js";
import {
  SANDBOX_CONFIG,
  TOOL_CALLER,
  TOOL_NAME,
  TOOL_RESULT_STATUS,
} from "../constants/index.js";


export function createConnectorAccessTool({ agentContext }) {
  const runtime = agentContext?.runtime || {};
  const effectiveConfig = mergeConfig(
    runtime?.globalConfig || {},
    runtime?.userConfig || {},
  );
  const processConnectorTaskEnabled =
    effectiveConfig?.tools?.[TOOL_NAME.PROCESS_CONNECTOR_TOOL]?.enabled !== false;
  if (!processConnectorTaskEnabled) return [];

  const botManager = runtime?.botManager || null;
  const eventListener = runtime?.eventListener || null;
  const signal = runtime?.abortSignal || null;
  const userInteractionBridge = runtime?.userInteractionBridge || null;
  const userId = String(runtime?.userId || agentContext?.userId || "").trim();
  const systemRuntime = runtime?.systemRuntime || {};
  const sessionId = String(systemRuntime?.sessionId || "").trim();
  const parentDialogProcessId = resolveDialogProcessIdFromContext({ runtime });
  const allowUserInteraction =
    systemRuntime?.config?.allowUserInteraction !== false;
  const maxToolLoopTurns = Number(
    effectiveConfig?.tools?.[TOOL_NAME.PROCESS_CONNECTOR_TOOL]?.maxToolLoopTurns ??
      6,
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
      if (!botManager || !userId || !sessionId) {
        throw recoverableToolError(
          tTool(runtime, "common.runtimeMissingBotManagerUserIdSessionId"),
          {
            code: ERROR_CODE.RECOVERABLE_RUNTIME_CONTEXT_MISSING,
          },
        );
      }
      const subTools = [
        ...createConnectorTools({ agentContext }),
      ];
      if (!subTools.length) {
        throw recoverableToolError(
          tTool(runtime, "tools.process_connector.errorToolsUnavailable"),
          {
            code: ERROR_CODE.RECOVERABLE_TOOLS_UNAVAILABLE,
          },
        );
      }
      try {
        const subSessionId = randomUUID();
        const subResult = await botManager.runSession({
          userId,
          sessionId: subSessionId,
          message: normalizedTask,
          caller: TOOL_CALLER.BOT,
          parentSessionId: sessionId,
          parentDialogProcessId,
          eventListener,
          userInteractionBridge,
          runConfig: {
            allowUserInteraction,
            selectedConnectors:
              runtime?.systemRuntime?.config?.selectedConnectors &&
              typeof runtime.systemRuntime.config.selectedConnectors === "object"
                ? runtime.systemRuntime.config.selectedConnectors
                : {},
            toolPolicy: {
              mode: SANDBOX_CONFIG.TOOL_POLICY_MODE.CUSTOM_ONLY,
              customTools: subTools,
              forceIncludeUserInteraction: false,
            },
            runtimeModel: String(modelName || "").trim(),
            maxToolLoopTurns:
              Number.isFinite(maxToolLoopTurns) && maxToolLoopTurns > 0
                ? Math.floor(maxToolLoopTurns)
                : 6,
            sharedTools:
              runtime?.sharedTools && typeof runtime.sharedTools === "object"
                ? runtime.sharedTools
                : {},
          },
          abortSignal: signal,
        });
        const answer = String(subResult?.answer || "").trim();
        const traces = Array.isArray(subResult?.traces) ? subResult.traces : [];
        const usedTools = Array.from(
          new Set(
            traces
              .map((item) => String(item?.tool || "").trim())
              .filter(Boolean),
          ),
        );
        return toToolJsonResult(
          TOOL_NAME.PROCESS_CONNECTOR_TOOL,
          {
            ok: true,
            status: TOOL_RESULT_STATUS.COMPLETED,
            sessionId: subSessionId,
            parentSessionId: sessionId,
            answer,
            tools: subTools.map((item) => item?.name).filter(Boolean),
            summary: {
              answer_length: answer.length,
              trace_count: traces.length,
              used_tools: usedTools,
              dialog_process_id: resolveMessageDialogProcessId(subResult),
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
