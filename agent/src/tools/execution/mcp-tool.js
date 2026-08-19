/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { DynamicStructuredTool } from "@langchain/core/tools";
import { runBestEffort } from "@noobot/shared/best-effort";
import { z } from "zod";
import { createMcpAgentTools } from "../../integrations/mcp/index.js";
import {
  BUILTIN_THRESHOLDS,
  hasOwnConfigKey,
  mergeConfig,
  normalizeBooleanLike,
} from "../../config/index.js";
import {
  getSessionIdsFromAgentContext,
  getRuntimeFromAgentContext,
  getChildRunParentSessionIdFromAgentContext,
} from "../../context/agent-context-accessor.js";
import { resolveContextMessageDialogProcessId } from "@noobot/context-protocol/message/codec";
import { recoverableToolError } from "../../shared/errors/index.js";
import { toToolJsonResult } from "../core/tool-json-result.js";
import { appendMcpErrorLog } from "../../observability/index.js";
import { tTool } from "../core/tool-i18n.js";
import { isAbortError } from "../../shared/utils/error-utils.js";
import { normalizeSelectedConnectors } from "@noobot/agent-config-protocol/enums";
import { createAgentDetachedSubSessionStrategy } from "../../bot/session/detached-subsession-strategy.js";
import { ERROR_CODE } from "../../shared/errors/constants.js";
import {
  TOOL_POLICY_MODE,
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
    }),
    func: async ({ mcpName, task }) => {
      const normalizedMcpName = String(mcpName || "").trim();
      const normalizedTask = String(task || "").trim();
      if (!normalizedMcpName) {
        throw recoverableToolError(tTool(runtime, "tools.mcp.errorMcpNameRequired"), {
          code: ERROR_CODE.RECOVERABLE_INPUT_MISSING,
        });
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
      const basePath = String(runtime.basePath || "").trim();
      const workspaceRoot = String(globalConfig?.workspaceRoot || "").trim();
      const contextIdentity = getSessionIdsFromAgentContext(agentContext);
      const userId = contextIdentity.userId;
      const sessionId = contextIdentity.sessionId;
      const parentSessionId = getChildRunParentSessionIdFromAgentContext(agentContext);
      const parentDialogProcessId = contextIdentity.dialogProcessId;
      const allowUserInteraction = systemRuntime?.config?.allowUserInteraction !== false;
      const hasParentStreamingConfig = hasOwnConfigKey(systemRuntime?.config || {}, "streaming");
      const maxToolLoopTurns = BUILTIN_THRESHOLDS.subTasks.callMcpTaskMaxToolLoopTurns;
      try {
        if (typeof botManager?.runDetachedSubSession !== "function" || !userId || !sessionId) {
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
            typeof runtime?.sharedTools?.fetch === "function" ? runtime.sharedTools.fetch : null,
        });
        if (!Array.isArray(mcpToolset?.tools) || !mcpToolset.tools.length) {
          throw recoverableToolError(tTool(runtime, "mcp.noToolsAvailable"), {
            code: ERROR_CODE.RECOVERABLE_TOOLS_UNAVAILABLE,
          });
        }
        const subTaskMessage = [`${tTool(runtime, "bot.taskPrefix")}: ${normalizedTask}`].join(
          "\n",
        );
        const detachedRun = await botManager.runDetachedSubSession({
          parentExecutionScope: agentContext,
          message: subTaskMessage,
          eventListener,
          abortSignal: signal,
          strategy: createAgentDetachedSubSessionStrategy({
            userId,
            parentSessionId,
            parentDialogProcessId,
          }),
          metadata: {
            scope: TOOL_NAME.CALL_MCP_TASK,
          },
          runConfigPatch: {
            pluginPolicy: { mode: "none" },
            allowUserInteraction,
            ...(hasParentStreamingConfig
              ? { streaming: normalizeBooleanLike(systemRuntime?.config?.streaming, false) }
              : {}),
            selectedConnectors: normalizeSelectedConnectors(
              runtime?.systemRuntime?.config?.selectedConnectors || {},
            ),
            toolPolicy: {
              mode: TOOL_POLICY_MODE.CUSTOM_ONLY,
              customTools: mcpToolset.tools,
            },
            maxToolLoopTurns:
              Number.isFinite(maxToolLoopTurns) && maxToolLoopTurns > 0
                ? Math.floor(maxToolLoopTurns)
                : 6,
            sharedTools:
              runtime?.sharedTools && typeof runtime.sharedTools === "object"
                ? runtime.sharedTools
                : {},
          },
        });
        const subSessionId = String(detachedRun?.sessionId || "").trim();
        const subResult = detachedRun?.result || {};
        const subAnswer = String(subResult?.answer || "").trim();
        const subTraces = Array.isArray(subResult?.traces) ? subResult.traces : [];
        const subMessages = Array.isArray(subResult?.messages) ? subResult.messages : [];
        const traceToolNames = Array.from(
          new Set(subTraces.map((item) => String(item?.tool || "").trim()).filter(Boolean)),
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
              dialog_process_id: resolveContextMessageDialogProcessId(subResult),
            },
            error: "",
          },
          true,
        );
      } catch (error) {
        if (isAbortError(error)) throw error;
        if (basePath) {
          await runBestEffort(
            () =>
              appendMcpErrorLog({
                basePath,
                workspaceRoot,
                userId,
                sessionId,
                parentSessionId,
                mcpName: normalizedMcpName,
                task: normalizedTask,
                source: TOOL_NAME.CALL_MCP_TASK,
                event: TOOL_EVENT_NAME.CALL_MCP_TASK_FAILED,
                message: error?.message || String(error),
                stack: error?.stack || "",
                details: error?.details && typeof error.details === "object" ? error.details : {},
              }),
            {
              operationName: "mcpTool.appendFailureLog",
              context: { mcpName: normalizedMcpName },
            },
          );
        }
        throw recoverableToolError(error?.message || String(error), {
          code: String(error?.code || ERROR_CODE.RECOVERABLE_CALL_MCP_TASK_FAILED),
        });
      }
    },
  });

  return [callMcpTaskTool];
}
