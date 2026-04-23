/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { DynamicStructuredTool } from "@langchain/core/tools";
import { z } from "zod";
import { randomUUID } from "node:crypto";
import { createMcpAgentTools } from "../mcp/index.js";
import { toToolJsonResult } from "./tool-json-result.js";
import { appendMcpErrorLog } from "../tracking/index.js";

function jsonError(payload = {}) {
  return toToolJsonResult("call_mcp_task", { ok: false, ...payload });
}

export function createMcpTool({ agentContext }) {
  const callMcpTaskTool = new DynamicStructuredTool({
    name: "call_mcp_task",
    description: "调用指定 MCP Server 完成任务。传入 mcpName 与 task。",
    schema: z.object({
      mcpName: z.string().describe("MCP 服务名称，对应配置 mcpServers 的 key"),
      task: z.string().describe("要让 MCP 工具链执行的任务描述"),
      modelName: z.string().optional().describe("可选：指定执行该任务使用的模型别名或模型名"),
    }),
    func: async ({ mcpName, task, modelName = "" }) => {
      const normalizedMcpName = String(mcpName || "").trim();
      const normalizedTask = String(task || "").trim();
      if (!normalizedMcpName) return jsonError({ error: "mcpName required" });
      if (!normalizedTask) return jsonError({ error: "task required" });

      const runtime = agentContext?.runtime || {};
      const globalConfig = runtime?.globalConfig || {};
      const userConfig = runtime?.userConfig || {};
      const systemRuntime = runtime?.systemRuntime || {};
      const botManager = runtime?.botManager || null;
      const eventListener = runtime?.eventListener || null;
      const signal = runtime?.abortSignal || null;
      const userInteractionBridge = runtime?.userInteractionBridge || null;
      const basePath = String(agentContext?.basePath || "").trim();
      const workspaceRoot = String(globalConfig?.workspaceRoot || "").trim();
      const userId = String(runtime?.userId || agentContext?.userId || "").trim();
      const sessionId = String(systemRuntime?.sessionId || "").trim();
      const parentSessionId = sessionId;
      const parentDialogProcessId = String(
        systemRuntime?.dialogProcessId || "",
      ).trim();
      const resolvedModelName = String(modelName || "").trim();
      try {
        if (!botManager || !userId || !sessionId) {
          return jsonError({
            mcpName: normalizedMcpName,
            error: "runtime missing botManager/userId/sessionId",
          });
        }
        const mcpToolset = await createMcpAgentTools({
          globalConfig,
          userConfig,
          mcpName: normalizedMcpName,
          signal,
        });
        if (!Array.isArray(mcpToolset?.tools) || !mcpToolset.tools.length) {
          return toToolJsonResult("call_mcp_task", {
            ok: true,
            mcpName: normalizedMcpName,
            status: "completed",
            tools: [],
            answer: "MCP服务器无可用工具。",
          });
        }
        const subSessionId = randomUUID();
        const subTaskMessage = [
          `任务: ${normalizedTask}`
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
            allowUserInteraction: true,
            toolPolicy: {
              mode: "custom_only",
              customTools: mcpToolset.tools,
              includeToolNames: ["user_interaction"],
            },
            runtimeModel: resolvedModelName || "",
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
            traces: subTraces,
            messages: subMessages,
            error: "",
          },
          true,
        );
      } catch (error) {
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
