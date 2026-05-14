/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { DynamicStructuredTool } from "@langchain/core/tools";
import { z } from "zod";
import { randomUUID } from "node:crypto";
import { mergeConfig } from "../../config/index.js";
import { recoverableToolError } from "../../error/index.js";
import { toToolJsonResult } from "../core/tool-json-result.js";
import { tTool } from "../core/tool-i18n.js";
import { isAbortError } from "../../utils/error-utils.js";
import { createConnectorTools } from "./connector-toolkit.js";


export function createConnectorAccessTool({ agentContext }) {
  const runtime = agentContext?.runtime || {};
  const effectiveConfig = mergeConfig(
    runtime?.globalConfig || {},
    runtime?.userConfig || {},
  );
  const processConnectorTaskEnabled =
    effectiveConfig?.tools?.process_connector_tool?.enabled !== false;
  if (!processConnectorTaskEnabled) return [];

  const botManager = runtime?.botManager || null;
  const eventListener = runtime?.eventListener || null;
  const signal = runtime?.abortSignal || null;
  const userInteractionBridge = runtime?.userInteractionBridge || null;
  const userId = String(runtime?.userId || agentContext?.userId || "").trim();
  const systemRuntime = runtime?.systemRuntime || {};
  const sessionId = String(systemRuntime?.sessionId || "").trim();
  const parentDialogProcessId = String(systemRuntime?.dialogProcessId || "").trim();
  const allowUserInteraction =
    systemRuntime?.config?.allowUserInteraction !== false;
  const maxToolLoopTurns = Number(
    effectiveConfig?.tools?.process_connector_tool?.maxToolLoopTurns ??
      6,
  );

  const processConnectorTaskTool = new DynamicStructuredTool({
    name: "process_connector_tool",
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
          code: "RECOVERABLE_INPUT_MISSING",
        });
      }
      if (!botManager || !userId || !sessionId) {
        throw recoverableToolError(
          tTool(runtime, "common.runtimeMissingBotManagerUserIdSessionId"),
          {
            code: "RECOVERABLE_RUNTIME_CONTEXT_MISSING",
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
            code: "RECOVERABLE_TOOLS_UNAVAILABLE",
          },
        );
      }
      try {
        const subSessionId = randomUUID();
        const subResult = await botManager.runSession({
          userId,
          sessionId: subSessionId,
          message: normalizedTask,
          caller: "bot",
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
              mode: "custom_only",
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
          "process_connector_tool",
          {
            ok: true,
            status: "completed",
            sessionId: subSessionId,
            parentSessionId: sessionId,
            answer,
            tools: subTools.map((item) => item?.name).filter(Boolean),
            summary: {
              answer_length: answer.length,
              trace_count: traces.length,
              used_tools: usedTools,
              dialog_process_id: String(subResult?.dialogProcessId || ""),
            },
          },
          true,
        );
      } catch (error) {
        if (isAbortError(error)) throw error;
        throw recoverableToolError(error?.message || String(error), {
          code: String(error?.code || "RECOVERABLE_PROCESS_CONNECTOR_FAILED"),
        });
      }
    },
  });

  return [processConnectorTaskTool];
}
