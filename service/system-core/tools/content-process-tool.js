/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { DynamicStructuredTool } from "@langchain/core/tools";
import { z } from "zod";
import { randomUUID } from "node:crypto";
import { toToolJsonResult } from "./tool-json-result.js";
import { mergeConfig } from "../config/index.js";
import { createDoc2DataTool } from "./doc/doc2data-tool.js";
import { createWebSearchTool } from "./web/web-search-tool.js";
import { createWeb2DataTool } from "./web/web2data-tool.js";

function jsonError(payload = {}) {
  return toToolJsonResult("process_content_task", { ok: false, ...payload });
}

export function createContentProcessTool({ agentContext }) {
  const runtime = agentContext?.runtime || {};
  const effectiveConfig = mergeConfig(
    runtime?.globalConfig || {},
    runtime?.userConfig || {},
  );
  const isToolEnabled = (toolKey = "", defaultEnabled = true) =>
    effectiveConfig?.tools?.[toolKey]?.enabled !== false
      ? defaultEnabled
      : false;
  const docToDataEnabled = isToolEnabled("doc_to_data", true);
  const webSearchEnabled = isToolEnabled("web_search_to_data", true);
  const webToDataEnabled = isToolEnabled("web_to_data", true);
  const configuredMaxToolLoopTurns = Number(
    effectiveConfig?.tools?.process_content_task?.maxToolLoopTurns,
  );
  const resolvedMaxToolLoopTurns =
    Number.isFinite(configuredMaxToolLoopTurns) &&
    configuredMaxToolLoopTurns > 0
      ? Math.min(20, Math.max(1, Math.floor(configuredMaxToolLoopTurns)))
      : 2;
  const contentProcessTools = [
    ...(docToDataEnabled ? createDoc2DataTool({ agentContext }) : []),
    ...(webSearchEnabled ? createWebSearchTool({ agentContext }) : []),
    ...(webToDataEnabled ? createWeb2DataTool({ agentContext }) : []),
  ];
  const contentProcessToolNames = contentProcessTools
    .map((tool) => String(tool?.name || "").trim())
    .filter(Boolean);
  const toolDescMap = {
    doc_to_data: "文档解析（office/pdf/图片提取文本）",
    web_search_to_data: "网页搜索并解析（搜索后筛选链接并解析）",
    web_to_data: "指定网页解析（URL 或 URL 列表文件）",
  };
  const enabledToolDescList = contentProcessToolNames.map((toolName) => {
    const desc = toolDescMap[toolName] || "通用内容处理";
    return `${toolName}: ${desc}`;
  });
  const dynamicDescription = contentProcessToolNames.length
    ? `内容处理工具：当前启用子工具：${enabledToolDescList.join("；")}。子会话仅允许调用以上已启用工具。`
    : "内容处理工具：当前未启用任何子工具。";

  const processContentTaskTool = new DynamicStructuredTool({
    name: "process_content_task",
    description: dynamicDescription,
    schema: z.object({
      task: z
        .string()
        .describe(
          "任务说明。请明确输入来源和目标输出，例如：'搜索英伟达DGX是什么，并汇总3个来源的核心结论'",
        ),
      modelName: z.string().optional().describe("可选：指定子任务执行模型（别名或模型名）"),
    }),
    func: async ({ task, modelName = "" }) => {
      const normalizedTask = String(task || "").trim();
      if (!normalizedTask) return jsonError({ error: "task required" });

      const systemRuntime = runtime?.systemRuntime || {};
      const botManager = runtime?.botManager || null;
      const eventListener = runtime?.eventListener || null;
      const signal = runtime?.abortSignal || null;
      const userInteractionBridge = runtime?.userInteractionBridge || null;
      const userId = String(runtime?.userId || agentContext?.userId || "").trim();
      const sessionId = String(systemRuntime?.sessionId || "").trim();
      const parentSessionId = sessionId;
      const parentDialogProcessId = String(
        systemRuntime?.dialogProcessId || "",
      ).trim();
      const resolvedModelName = String(modelName || "").trim();
      if (!botManager || !userId || !sessionId) {
        return jsonError({
          error: "runtime missing botManager/userId/sessionId",
        });
      }
      if (!contentProcessTools.length) {
        return jsonError({
          error: "content process tools not available",
        });
      }

      try {
        const subSessionId = randomUUID();
        const subResult = await botManager.runSession({
          userId,
          sessionId: subSessionId,
          message: normalizedTask,
          caller: "bot",
          parentSessionId,
          parentDialogProcessId,
          eventListener,
          userInteractionBridge,
          runConfig: {
            allowUserInteraction: true,
            toolPolicy: {
              mode: "custom_only",
              customTools: contentProcessTools,
            },
            runtimeModel: resolvedModelName || "",
            maxToolLoopTurns: resolvedMaxToolLoopTurns,
            sharedTools:
              runtime?.sharedTools && typeof runtime.sharedTools === "object"
                ? runtime.sharedTools
                : {},
          },
          abortSignal: signal,
        });

        return toToolJsonResult(
          "process_content_task",
          {
            ok: true,
            status: "completed",
            sessionId: subSessionId,
            parentSessionId,
            tools: contentProcessToolNames,
            maxToolLoopTurns: resolvedMaxToolLoopTurns,
            answer: String(subResult?.answer || "").trim(),
            traces: Array.isArray(subResult?.traces) ? subResult.traces : [],
            messages: Array.isArray(subResult?.messages) ? subResult.messages : [],
            error: "",
          },
          true,
        );
      } catch (error) {
        return jsonError({
          error: error?.message || String(error),
        });
      }
    },
  });

  return [processContentTaskTool];
}
