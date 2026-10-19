/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { tool as structuredTool } from "@langchain/core/tools";
import { runBestEffort } from "@noobot/shared/best-effort";
import { z } from "zod";
import { createMcpAgentTools } from "../../integrations/mcp/index.js";
import { BUILTIN_THRESHOLDS, hasOwnConfigKey } from "../../config/index.js";
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
import { createAgentDetachedSubSessionStrategy } from "../../bot/session/detached-subsession-strategy.js";
import { ERROR_CODE } from "../../shared/errors/constants.js";
import {
  TOOL_POLICY_MODE,
  TOOL_EVENT_NAME,
  TOOL_NAME,
  TOOL_RESULT_STATUS,
} from "../constants/index.js";
import { text, isFunction } from "@noobot/shared/value";

function buildMcpTaskResult({ detachedRun, mcpName, parentSessionId, mcpToolset }) {
  const { answer, traces, messages } = detachedRun.result;
  const usedTools = Array.from(new Set(traces.map((item) => text(item.tool)).filter(Boolean)));
  return toToolJsonResult(
    TOOL_NAME.CALL_MCP_TASK,
    {
      ok: true,
      mcpName,
      status: TOOL_RESULT_STATUS.COMPLETED,
      sessionId: detachedRun.sessionId,
      parentSessionId,
      tools: mcpToolset.toolNames,
      answer,
      summary: {
        answerLength: answer.length,
        traceCount: traces.length,
        messageCount: messages.length,
        usedTools,
        dialogProcessId: resolveContextMessageDialogProcessId(detachedRun.result),
      },
      error: "",
    },
    true,
  );
}

function requireTaskInput(runtime, { mcpName, task }) {
  const input = { mcpName: text(mcpName), task: text(task) };
  if (!input.mcpName) {
    throw recoverableToolError(tTool(runtime, "tools.mcp.errorMcpNameRequired"), {
      code: ERROR_CODE.RECOVERABLE_INPUT_MISSING,
    });
  }
  if (!input.task) {
    throw recoverableToolError(tTool(runtime, "common.taskRequired"), {
      code: ERROR_CODE.RECOVERABLE_INPUT_MISSING,
    });
  }
  return input;
}

function requireRunContext(runtime, identity) {
  if (!isFunction(runtime.botManager?.runDetachedSubSession)) {
    throw runContextMissing(runtime);
  }
  if (!identity.userId || !identity.sessionId) throw runContextMissing(runtime);
}

function runContextMissing(runtime) {
  return recoverableToolError(tTool(runtime, "common.runtimeMissingBotManagerUserIdSessionId"), {
    code: ERROR_CODE.RECOVERABLE_RUNTIME_CONTEXT_MISSING,
  });
}

function buildSubSessionRunConfigPatch(runtime, mcpToolset) {
  const { config } = runtime.systemRuntime;
  return {
    pluginPolicy: { mode: "none" },
    allowUserInteraction: config.allowUserInteraction,
    ...(hasOwnConfigKey(config, "streaming") ? { streaming: config.streaming } : {}),
    selectedConnectorIds: config.selectedConnectorIds,
    toolPolicy: { mode: TOOL_POLICY_MODE.CUSTOM_ONLY, customTools: mcpToolset.tools },
    maxToolLoopTurns: BUILTIN_THRESHOLDS.subTasks.callMcpTaskMaxToolLoopTurns,
    sharedTools: runtime.sharedTools,
  };
}

async function runMcpTask({
  agentContext,
  runtime,
  input,
  identity,
  parentSessionId,
  mcpToolset,
  abortSignal,
}) {
  if (!mcpToolset.tools.length) {
    throw recoverableToolError(tTool(runtime, "mcp.noToolsAvailable"), {
      code: ERROR_CODE.RECOVERABLE_TOOLS_UNAVAILABLE,
    });
  }
  const detachedRun = await runtime.botManager.runDetachedSubSession({
    parentExecutionScope: agentContext,
    message: `${tTool(runtime, "bot.taskPrefix")}: ${input.task}`,
    eventListener: runtime.eventListener,
    abortSignal,
    strategy: createAgentDetachedSubSessionStrategy({
      userId: identity.userId,
      parentSessionId,
      parentDialogProcessId: identity.dialogProcessId,
    }),
    metadata: { scope: TOOL_NAME.CALL_MCP_TASK },
    runConfigPatch: buildSubSessionRunConfigPatch(runtime, mcpToolset),
  });
  return buildMcpTaskResult({ detachedRun, mcpName: input.mcpName, parentSessionId, mcpToolset });
}

function logMcpTaskFailure({ runtime, identity, parentSessionId, input, error }) {
  return runBestEffort(
    () =>
      appendMcpErrorLog({
        basePath: runtime.basePath,
        workspaceRoot: text(runtime.globalConfig.workspaceRoot),
        userId: identity.userId,
        sessionId: identity.sessionId,
        parentSessionId,
        mcpName: input.mcpName,
        task: input.task,
        source: TOOL_NAME.CALL_MCP_TASK,
        event: TOOL_EVENT_NAME.CALL_MCP_TASK_FAILED,
        message: error.message,
        stack: error.stack,
        details: error.details,
      }),
    { operationName: "mcpTool.appendFailureLog", context: { mcpName: input.mcpName } },
  );
}

export function createMcpTool({ agentContext }) {
  const runtime = getRuntimeFromAgentContext(agentContext);
  const callMcpTaskTool = structuredTool(
    async (rawInput, toolConfig) => {
      const abortSignal = toolConfig.signal;
      const input = requireTaskInput(runtime, rawInput);
      const identity = getSessionIdsFromAgentContext(agentContext);
      const parentSessionId = getChildRunParentSessionIdFromAgentContext(agentContext);
      let mcpToolset = null;
      const closeOnAbort = () =>
        runBestEffort(() => mcpToolset?.close(), {
          operationName: "mcpTool.closeToolsetOnAbort",
          context: { mcpName: input.mcpName },
        });
      try {
        requireRunContext(runtime, identity);
        mcpToolset = await createMcpAgentTools({
          globalConfig: runtime.globalConfig,
          userConfig: runtime.userConfig,
          mcpName: input.mcpName,
          signal: abortSignal,
          fetchImpl: runtime.sharedTools.fetch,
        });
        abortSignal.addEventListener("abort", closeOnAbort, { once: true });
        return await runMcpTask({
          agentContext,
          runtime,
          input,
          identity,
          parentSessionId,
          mcpToolset,
          abortSignal,
        });
      } catch (error) {
        if (isAbortError(error)) throw error;
        await logMcpTaskFailure({ runtime, identity, parentSessionId, input, error });
        throw recoverableToolError(error.message, {
          code: String(error.code || ERROR_CODE.RECOVERABLE_CALL_MCP_TASK_FAILED),
        });
      } finally {
        abortSignal.removeEventListener("abort", closeOnAbort);
        await runBestEffort(() => mcpToolset?.close(), {
          operationName: "mcpTool.closeToolset",
          context: { mcpName: input.mcpName },
        });
      }
    },
    {
      name: TOOL_NAME.CALL_MCP_TASK,
      description: tTool(runtime, "tools.mcp.description"),
      schema: z.object({
        mcpName: z.string().describe(tTool(runtime, "tools.mcp.fieldMcpName")),
        task: z.string().describe(tTool(runtime, "tools.mcp.fieldTask")),
      }),
    },
  );

  return [callMcpTaskTool];
}
