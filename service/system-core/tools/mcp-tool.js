/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { DynamicStructuredTool } from "@langchain/core/tools";
import { z } from "zod";
import { randomUUID } from "node:crypto";
import { createMcpAgentTools } from "../mcp/index.js";
import { mergeConfig } from "../config/index.js";
import { toToolJsonResult } from "./tool-json-result.js";
import { appendMcpErrorLog } from "../tracking/index.js";
import { tTool } from "./tool-i18n.js";

function jsonError(payload = {}) {
  return toToolJsonResult("call_mcp_task", { ok: false, ...payload });
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

function normalizeSelectedConnectors(selectedConnectors = {}) {
  const source =
    selectedConnectors && typeof selectedConnectors === "object"
      ? selectedConnectors
      : {};
  return Object.fromEntries(
    Object.entries(source)
      .map(([connectorType, connectorName]) => [
        String(connectorType || "").trim(),
        String(connectorName || "").trim(),
      ])
      .filter(([connectorType]) => Boolean(connectorType)),
  );
}

export function createMcpTool({ agentContext }) {
  const runtime = agentContext?.runtime || {};
  const callMcpTaskTool = new DynamicStructuredTool({
    name: "call_mcp_task",
    description: tTool(runtime, "tools.mcp.description"),
    schema: z.object({
      mcpName: z.string().describe(tTool(runtime, "tools.mcp.fieldMcpName")),
      task: z.string().describe(tTool(runtime, "tools.mcp.fieldTask")),
      modelName: z.string().optional().describe(tTool(runtime, "tools.mcp.fieldModelName")),
    }),
    func: async ({ mcpName, task, modelName = "" }) => {
      const normalizedMcpName = String(mcpName || "").trim();
      const normalizedTask = String(task || "").trim();
      if (!normalizedMcpName) {
        return jsonError({ error: tTool(runtime, "tools.mcp.errorMcpNameRequired") });
      }
      if (!normalizedTask) {
        return jsonError({ error: tTool(runtime, "common.taskRequired") });
      }

      const globalConfig = runtime?.globalConfig || {};
      const userConfig = runtime?.userConfig || {};
      const effectiveConfig = mergeConfig(globalConfig, userConfig);
      const systemRuntime = runtime?.systemRuntime || {};
      const botManager = runtime?.botManager || null;
      const eventListener = runtime?.eventListener || null;
      const signal = runtime?.abortSignal || null;
      const userInteractionBridge = runtime?.userInteractionBridge || null;
      const basePath = String(
        agentContext?.environment?.workspace?.basePath ||
          runtime?.basePath ||
          "",
      ).trim();
      const workspaceRoot = String(globalConfig?.workspaceRoot || "").trim();
      const userId = String(runtime?.userId || agentContext?.userId || "").trim();
      const sessionId = String(systemRuntime?.sessionId || "").trim();
      const parentSessionId = sessionId;
      const parentDialogProcessId = String(
        systemRuntime?.dialogProcessId || "",
      ).trim();
      const resolvedModelName = String(modelName || "").trim();
      const allowUserInteraction =
        systemRuntime?.config?.allowUserInteraction !== false;
      const maxToolLoopTurns = Number(
        effectiveConfig?.tools?.call_mcp_task?.maxToolLoopTurns ??
          6,
      );
      try {
        if (!botManager || !userId || !sessionId) {
          return jsonError({
            mcpName: normalizedMcpName,
            error: tTool(runtime, "common.runtimeMissingBotManagerUserIdSessionId"),
          });
        }
        const mcpToolset = await createMcpAgentTools({
          globalConfig,
          userConfig,
          mcpName: normalizedMcpName,
          signal,
          fetchImpl:
            typeof runtime?.sharedTools?.fetch === "function"
              ? runtime.sharedTools.fetch
              : null,
        });
        if (!Array.isArray(mcpToolset?.tools) || !mcpToolset.tools.length) {
          return toToolJsonResult("call_mcp_task", {
            ok: true,
            mcpName: normalizedMcpName,
            status: "completed",
            tools: [],
            answer: tTool(runtime, "mcp.noToolsAvailable"),
          });
        }
        const subSessionId = randomUUID();
        const subTaskMessage = [
          `${tTool(runtime, "bot.taskPrefix")}: ${normalizedTask}`,
        ].join("\n");
        const subResult = await botManager.runSession({
          userId,
          sessionId: subSessionId,
          message: subTaskMessage,
          caller: "bot",
          parentSessionId,
          parentDialogProcessId,
          eventListener,
          userInteractionBridge,
          runConfig: {
            allowUserInteraction,
            selectedConnectors: normalizeSelectedConnectors(
              runtime?.systemRuntime?.config?.selectedConnectors || {},
            ),
            toolPolicy: {
              mode: "custom_only",
              customTools: mcpToolset.tools,
            },
            runtimeModel: resolvedModelName || "",
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
        const subAnswer = String(subResult?.answer || "").trim();
        const subTraces = Array.isArray(subResult?.traces) ? subResult.traces : [];
        const subMessages = Array.isArray(subResult?.messages)
          ? subResult.messages
          : [];
        const traceToolNames = Array.from(
          new Set(
            subTraces
              .map((item) => String(item?.tool || "").trim())
              .filter(Boolean),
          ),
        );
        return toToolJsonResult(
          "call_mcp_task",
          {
            ok: true,
            mcpName: normalizedMcpName,
            status: "completed",
            sessionId: subSessionId,
            parentSessionId,
            tools: mcpToolset.toolNames || [],
            answer: subAnswer,
            summary: {
              answer_length: subAnswer.length,
              trace_count: subTraces.length,
              message_count: subMessages.length,
              used_tools: traceToolNames,
              dialog_process_id: String(subResult?.dialogProcessId || ""),
            },
            error: "",
          },
          true,
        );
      } catch (error) {
        if (isAbortError(error)) throw error;
        if (basePath) {
          await appendMcpErrorLog({
            basePath,
            workspaceRoot,
            userId,
            sessionId,
            parentSessionId,
            mcpName: normalizedMcpName,
            task: normalizedTask,
            modelName: resolvedModelName,
            source: "call_mcp_task",
            event: "call_mcp_task_failed",
            message: error?.message || String(error),
            stack: error?.stack || "",
            details:
              error?.details && typeof error.details === "object"
                ? error.details
                : {},
          }).catch(() => {});
        }
        return jsonError({
          mcpName: normalizedMcpName,
          error: error?.message || String(error),
        });
      }
    },
  });

  return [callMcpTaskTool];
}
