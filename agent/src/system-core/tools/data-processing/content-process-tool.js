/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { DynamicStructuredTool } from "@langchain/core/tools";
import { z } from "zod";
import { randomUUID } from "node:crypto";
import { recoverableToolError } from "../../error/index.js";
import { resolveMessageDialogProcessId } from "../../context/session/dialog-process-id-resolver.js";
import {
  getRuntimeFromAgentContext,
  resolveChildRunParentSessionIdFromRuntime,
} from "../../context/agent-context-accessor.js";
import { toToolJsonResult } from "../core/tool-json-result.js";
import { mergeConfig } from "../../config/index.js";
import { createDoc2DataTool } from "./doc2data-tool.js";
import { createMedia2DataTool } from "./media2data-tool.js";
import { createWeb2DataTool } from "./web2data-tool.js";
import { tTool } from "../core/tool-i18n.js";
import { isAbortError } from "../../utils/error-utils.js";
import { normalizeSelectedConnectors } from "../../utils/shared-utils.js";
import { resolveDialogProcessIdFromContext } from "../../context/session/dialog-process-id-resolver.js";
import { ERROR_CODE } from "../../error/constants.js";
import {
  SANDBOX_CONFIG,
  TOOL_CALLER,
  TOOL_NAME,
  TOOL_RESULT_STATUS,
} from "../constants/index.js";

export function createContentProcessTool({ agentContext }) {
  const runtime = getRuntimeFromAgentContext(agentContext);
  const effectiveConfig = mergeConfig(
    runtime?.globalConfig || {},
    runtime?.userConfig || {},
  );
  const isToolEnabled = (toolKey = "", defaultEnabled = true) =>
    effectiveConfig?.tools?.[toolKey]?.enabled !== false
      ? defaultEnabled
      : false;
  const docToDataEnabled = isToolEnabled(TOOL_NAME.DOC_TO_DATA, true);
  const mediaToDataEnabled = isToolEnabled(TOOL_NAME.MEDIA_TO_DATA, true);
  const webToDataEnabled = isToolEnabled(TOOL_NAME.WEB_TO_DATA, true);
  const configuredMaxToolLoopTurns = Number(
    effectiveConfig?.tools?.[TOOL_NAME.PROCESS_CONTENT_TASK]?.maxToolLoopTurns,
  );
  const resolvedMaxToolLoopTurns =
    Number.isFinite(configuredMaxToolLoopTurns) &&
    configuredMaxToolLoopTurns > 0
      ? Math.min(20, Math.max(1, Math.floor(configuredMaxToolLoopTurns)))
      : 4;
  const contentProcessTools = [
    ...(docToDataEnabled ? createDoc2DataTool({ agentContext }) : []),
    ...(mediaToDataEnabled ? createMedia2DataTool({ agentContext }) : []),
    ...(webToDataEnabled ? createWeb2DataTool({ agentContext }) : []),
  ];
  const contentProcessToolNames = contentProcessTools
    .map((tool) => String(tool?.name || "").trim())
    .filter(Boolean);
  const toolDescMap = {
    [TOOL_NAME.DOC_TO_DATA]: tTool(runtime, "tools.content_process.toolDescDoc"),
    [TOOL_NAME.MEDIA_TO_DATA]: tTool(runtime, "tools.content_process.toolDescMedia"),
    [TOOL_NAME.WEB_TO_DATA]: tTool(runtime, "tools.content_process.toolDescWeb"),
  };
  const enabledToolDescList = contentProcessToolNames.map((toolName) => {
    const desc = toolDescMap[toolName] || tTool(runtime, "tools.content_process.toolDescGeneric");
    return `${toolName}: ${desc}`;
  });
  const dynamicDescription = contentProcessToolNames.length
    ? `${tTool(runtime, "tools.content_process.dynamicDescEnabledPrefix")}${enabledToolDescList.join("；")}${tTool(runtime, "tools.content_process.dynamicDescEnabledSuffix")}`
    : tTool(runtime, "tools.content_process.dynamicDescDisabled");

  const processContentTaskTool = new DynamicStructuredTool({
    name: TOOL_NAME.PROCESS_CONTENT_TASK,
    description: dynamicDescription,
    schema: z.object({
      task: z
        .string()
        .describe(tTool(runtime, "tools.content_process.fieldTask")),
      contentPath: z
        .string()
        .describe(tTool(runtime, "tools.content_process.fieldContentPath")),
      modelName: z.string().optional().describe(tTool(runtime, "tools.content_process.fieldModelName")),
    }),
    func: async ({ task, contentPath, modelName = "" }) => {
      const normalizedTask = String(task || "").trim();
      const normalizedContentPath = String(contentPath || "").trim();
      if (!normalizedTask) {
        throw recoverableToolError(tTool(runtime, "common.taskRequired"), {
          code: ERROR_CODE.RECOVERABLE_INPUT_MISSING,
        });
      }
      if (!normalizedContentPath) {
        throw recoverableToolError(
          tTool(runtime, "tools.content_process.errorContentPathRequired"),
          {
            code: ERROR_CODE.RECOVERABLE_INPUT_MISSING,
          },
        );
      }
      const composedTask = normalizedContentPath
        ? `${normalizedTask}\n\ncontent_path: ${normalizedContentPath}`
        : normalizedTask;

      const systemRuntime = runtime?.systemRuntime || {};
      const botManager = runtime?.botManager || null;
      const eventListener = runtime?.eventListener || null;
      const signal = runtime?.abortSignal || null;
      const userInteractionBridge = runtime?.userInteractionBridge || null;
      const userId = String(runtime?.userId || agentContext?.userId || "").trim();
      const sessionId = String(systemRuntime?.sessionId || "").trim();
      const parentSessionId = resolveChildRunParentSessionIdFromRuntime(runtime);
      const parentDialogProcessId = resolveDialogProcessIdFromContext({
        runtime,
      });
      const resolvedModelName = String(modelName || "").trim();
      const allowUserInteraction =
        systemRuntime?.config?.allowUserInteraction !== false;
      if (!botManager || !userId || !sessionId) {
        throw recoverableToolError(
          tTool(runtime, "common.runtimeMissingBotManagerUserIdSessionId"),
          {
            code: ERROR_CODE.RECOVERABLE_RUNTIME_CONTEXT_MISSING,
          },
        );
      }
      if (!contentProcessTools.length) {
        throw recoverableToolError(
          tTool(runtime, "tools.content_process.errorToolsUnavailable"),
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
          message: composedTask,
          caller: TOOL_CALLER.BOT,
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
              mode: SANDBOX_CONFIG.TOOL_POLICY_MODE.CUSTOM_ONLY,
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
          TOOL_NAME.PROCESS_CONTENT_TASK,
          {
            ok: true,
            status: TOOL_RESULT_STATUS.COMPLETED,
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
              dialog_process_id: resolveMessageDialogProcessId(subResult),
              content_path: normalizedContentPath,
            },
            error: "",
          },
          true,
        );
      } catch (error) {
        if (isAbortError(error)) throw error;
        throw recoverableToolError(error?.message || String(error), {
          code: String(error?.code || ERROR_CODE.RECOVERABLE_PROCESS_CONTENT_FAILED),
        });
      }
    },
  });

  return [processContentTaskTool];
}
