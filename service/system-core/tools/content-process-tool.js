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
import { createDoc2DataTool } from "./doc2data-tool.js";
import { createWeb2DataTool } from "./web2data-tool.js";

function jsonError(payload = {}) {
  return toToolJsonResult("process_content_task", { ok: false, ...payload });
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
    ...(webToDataEnabled ? createWeb2DataTool({ agentContext }) : []),
  ];
  const contentProcessToolNames = contentProcessTools
    .map((tool) => String(tool?.name || "").trim())
    .filter(Boolean);
  const toolDescMap = {
    doc_to_data: "解析文档内容（office/pdf/图片提取文本）",
    web_to_data: "解析网页内容（URL 或 URL 列表文件）",
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
          "任务说明。请明确输入来源和目标输出",
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
      const allowUserInteraction =
        systemRuntime?.config?.allowUserInteraction !== false;
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
            allowUserInteraction,
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
        const answer = String(subResult?.answer || "").trim();
        const traces = Array.isArray(subResult?.traces) ? subResult.traces : [];
        const messages = Array.isArray(subResult?.messages) ? subResult.messages : [];
        const usedTools = Array.from(
          new Set(
            traces
              .map((item) => String(item?.tool || "").trim())
              .filter(Boolean),
          ),
        );

        return toToolJsonResult(
          "process_content_task",
          {
            ok: true,
            status: "completed",
            sessionId: subSessionId,
            parentSessionId,
            tools: contentProcessToolNames,
            maxToolLoopTurns: resolvedMaxToolLoopTurns,
            answer,
            summary: {
              answer_length: answer.length,
              trace_count: traces.length,
              message_count: messages.length,
              used_tools: usedTools,
              dialog_process_id: String(subResult?.dialogProcessId || ""),
            },
            error: "",
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

  return [processContentTaskTool];
}
