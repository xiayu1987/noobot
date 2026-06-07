/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { DynamicStructuredTool } from "@langchain/core/tools";
import { z } from "zod";
import { randomUUID } from "node:crypto";
import { createMcpAgentTools } from "../../mcp/index.js";
import { hasOwnConfigKey, mergeConfig, normalizeBooleanLike } from "../../config/index.js";
import {
  getRuntimeFromAgentContext,
  resolveChildRunParentSessionIdFromRuntime,
} from "../../context/agent-context-accessor.js";
import { resolveMessageDialogProcessId } from "../../context/session/dialog-process-id-resolver.js";
import { recoverableToolError } from "../../error/index.js";
import { toToolJsonResult } from "../core/tool-json-result.js";
import { appendMcpErrorLog } from "../../tracking/index.js";
import { tTool } from "../core/tool-i18n.js";
import { isAbortError } from "../../utils/error-utils.js";
import { normalizeSelectedConnectors } from "../../utils/shared-utils.js";
import { resolveDialogProcessIdFromContext } from "../../context/session/dialog-process-id-resolver.js";
import { ERROR_CODE } from "../../error/constants.js";
import {
  SANDBOX_CONFIG,
  TOOL_CALLER,
  TOOL_EVENT_NAME,
  TOOL_NAME,
  TOOL_RESULT_STATUS,
} from "../constants/index.js";

export function createMcpTool({ agentContext }) {
  const runtime = getRuntimeFromAgentContext(agentContext);
  const callMcpTaskTool = new DynamicStructuredTool({
    name: TOOL_NAME.CALL_MCP_TASK,
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
        throw recoverableToolError(
          tTool(runtime, "tools.mcp.errorMcpNameRequired"),
          { code: ERROR_CODE.RECOVERABLE_INPUT_MISSING },
        );
      }
      if (!normalizedTask) {
        throw recoverableToolError(tTool(runtime, "common.taskRequired"), {
          code: ERROR_CODE.RECOVERABLE_INPUT_MISSING,
        });
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
      const parentSessionId = resolveChildRunParentSessionIdFromRuntime(runtime);
      const parentDialogProcessId = resolveDialogProcessIdFromContext({
        runtime,
      });
      const resolvedModelName = String(modelName || "").trim();
      const allowUserInteraction =
        systemRuntime?.config?.allowUserInteraction !== false;
      const hasParentStreamingConfig = hasOwnConfigKey(systemRuntime?.config || {}, "streaming");
      const maxToolLoopTurns = Number(
        effectiveConfig?.tools?.[TOOL_NAME.CALL_MCP_TASK]?.maxToolLoopTurns ??
          6,
      );
      try {
        if (!botManager || !userId || !sessionId) {
          throw recoverableToolError(
            tTool(runtime, "common.runtimeMissingBotManagerUserIdSessionId"),
            {
              code: ERROR_CODE.RECOVERABLE_RUNTIME_CONTEXT_MISSING,
            },
          );
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
          throw recoverableToolError(tTool(runtime, "mcp.noToolsAvailable"), {
            code: ERROR_CODE.RECOVERABLE_TOOLS_UNAVAILABLE,
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
          caller: TOOL_CALLER.BOT,
          parentSessionId,
          parentDialogProcessId,
          eventListener,
          userInteractionBridge,
          runConfig: {
            allowUserInteraction,
            ...(hasParentStreamingConfig
              ? { streaming: normalizeBooleanLike(systemRuntime?.config?.streaming, false) }
              : {}),
            selectedConnectors: normalizeSelectedConnectors(
              runtime?.systemRuntime?.config?.selectedConnectors || {},
            ),
            toolPolicy: {
              mode: SANDBOX_CONFIG.TOOL_POLICY_MODE.CUSTOM_ONLY,
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
          TOOL_NAME.CALL_MCP_TASK,
          {
            ok: true,
            mcpName: normalizedMcpName,
            status: TOOL_RESULT_STATUS.COMPLETED,
            sessionId: subSessionId,
            parentSessionId,
            tools: mcpToolset.toolNames || [],
            answer: subAnswer,
            summary: {
              answer_length: subAnswer.length,
              trace_count: subTraces.length,
              message_count: subMessages.length,
              used_tools: traceToolNames,
              dialog_process_id: resolveMessageDialogProcessId(subResult),
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
            source: TOOL_NAME.CALL_MCP_TASK,
            event: TOOL_EVENT_NAME.CALL_MCP_TASK_FAILED,
            message: error?.message || String(error),
            stack: error?.stack || "",
            details:
              error?.details && typeof error.details === "object"
                ? error.details
                : {},
          }).catch(() => {});
        }
        throw recoverableToolError(error?.message || String(error), {
          code: String(error?.code || ERROR_CODE.RECOVERABLE_CALL_MCP_TASK_FAILED),
        });
      }
    },
  });

  return [callMcpTaskTool];
}
