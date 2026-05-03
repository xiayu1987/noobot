/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { DynamicStructuredTool } from "@langchain/core/tools";
import { z } from "zod";
import { randomUUID } from "node:crypto";
import { mergeConfig } from "../../config/index.js";
import { toToolJsonResult } from "../tool-json-result.js";
import { tTool } from "../tool-i18n.js";
import { createConnectorChannelTools } from "./connector-channel-tools.js";

function jsonError(payload = {}) {
  return toToolJsonResult("process_connector_tool", { ok: false, ...payload });
}

function isAbortError(error) {
  const name = String(error?.name || "").trim().toLowerCase();
  const code = String(error?.code || "").trim().toUpperCase();
  const message = String(error?.message || "").toLowerCase();
  return (
    name === "aborterror" ||
    code === "ABORT_ERR" ||
    message.includes("aborterror") ||
    message.includes("stopped by user") ||
    message.includes("aborted")
  );
}

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
    effectiveConfig?.tools?.process_connector_tool?.max_tool_loop_turns ??
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
        return jsonError({
          error: tTool(runtime, "tools.process_connector.errorTaskRequired"),
        });
      }
      if (!botManager || !userId || !sessionId) {
        return jsonError({
          error: tTool(runtime, "tools.process_connector.errorRuntimeMissing"),
        });
      }
      const subTools = [
        ...createConnectorChannelTools({ agentContext }),
      ];
      if (!subTools.length) {
        return jsonError({
          error: tTool(runtime, "tools.process_connector.errorToolsUnavailable"),
        });
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
        return jsonError({
          error: error?.message || String(error),
        });
      }
    },
  });

  return [processConnectorTaskTool];
}
