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
import { pickToolText, resolveToolLocale, tTool } from "./tool-i18n.js";

function jsonError(payload = {}) {
  return toToolJsonResult("process_content_task", { ok: false, ...payload });
}

function tContent(runtime = {}, key = "") {
  const locale = resolveToolLocale(runtime);
  const dict = {
    taskRequired: { "zh-CN": "task required", "en-US": "task required" },
    runtimeMissing: {
      "zh-CN": "运行时缺少 botManager/userId/sessionId",
      "en-US": "runtime missing botManager/userId/sessionId",
    },
    toolsUnavailable: {
      "zh-CN": "内容处理工具不可用",
      "en-US": "content process tools not available",
    },
  };
  return pickToolText({ locale, dict, key });
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
      : 4;
  const contentProcessTools = [
    ...(docToDataEnabled ? createDoc2DataTool({ agentContext }) : []),
    ...(webToDataEnabled ? createWeb2DataTool({ agentContext }) : []),
  ];
  const contentProcessToolNames = contentProcessTools
    .map((tool) => String(tool?.name || "").trim())
    .filter(Boolean);
  const toolDescMap = {
    doc_to_data: tTool(runtime, "tools.content_process.toolDescDoc"),
    web_to_data: tTool(runtime, "tools.content_process.toolDescWeb"),
  };
  const enabledToolDescList = contentProcessToolNames.map((toolName) => {
    const desc = toolDescMap[toolName] || tTool(runtime, "tools.content_process.toolDescGeneric");
    return `${toolName}: ${desc}`;
  });
  const dynamicDescription = contentProcessToolNames.length
    ? `${tTool(runtime, "tools.content_process.dynamicDescEnabledPrefix")}${enabledToolDescList.join("；")}${tTool(runtime, "tools.content_process.dynamicDescEnabledSuffix")}`
    : tTool(runtime, "tools.content_process.dynamicDescDisabled");

  const processContentTaskTool = new DynamicStructuredTool({
    name: "process_content_task",
    description: dynamicDescription,
    schema: z.object({
      task: z
        .string()
        .describe(tTool(runtime, "tools.content_process.fieldTask")),
      modelName: z.string().optional().describe(tTool(runtime, "tools.content_process.fieldModelName")),
    }),
    func: async ({ task, modelName = "" }) => {
      const normalizedTask = String(task || "").trim();
      if (!normalizedTask) return jsonError({ error: tContent(runtime, "taskRequired") });

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
          error: tContent(runtime, "runtimeMissing"),
        });
      }
      if (!contentProcessTools.length) {
        return jsonError({
          error: tContent(runtime, "toolsUnavailable"),
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
            selectedConnectors: normalizeSelectedConnectors(
              runtime?.systemRuntime?.config?.selectedConnectors || {},
            ),
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
