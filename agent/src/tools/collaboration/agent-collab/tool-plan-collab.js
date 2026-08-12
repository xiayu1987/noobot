/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { DynamicStructuredTool } from "@langchain/core/tools";
import { z } from "zod";
import {
  RUNTIME_EVENT_CATEGORIES,
  RUNTIME_EVENT_CHANNELS,
  writeRoutedRuntimeEvent,
} from "@noobot/runtime-events";
import { resolveDefaultModelSpec, resolveModelSpecByName } from "../../../models/index.js";
import { recoverableToolError } from "../../../shared/errors/index.js";
import { toToolJsonResult } from "../../core/tool-json-result.js";
import { tTool } from "../../core/tool-i18n.js";
import { ERROR_CODE } from "../../../shared/errors/constants.js";
import { TOOL_NAME } from "../../constants/index.js";
import { MODEL_CONTEXT_SEQUENCE_POLICY } from "@noobot/model-protocol";

async function recordPlanJsonParseFallback({ runtime, event, error, hasMarkdownBlock }) {
  const userId = String(runtime?.userId || "").trim();
  const systemRuntime = runtime?.systemRuntime || {};
  const sessionId = String(systemRuntime?.sessionId || systemRuntime?.rootSessionId || "").trim();
  return writeRoutedRuntimeEvent(
    {
      source: "agent",
      channel: RUNTIME_EVENT_CHANNELS.DIRECT,
      category: RUNTIME_EVENT_CATEGORIES.SYSTEM,
      event,
      userId,
      sessionId,
      dialogProcessId: systemRuntime?.dialogProcessId || undefined,
      turnScopeId: systemRuntime?.turnScopeId || systemRuntime?.config?.turnScopeId || undefined,
      data: {
        toolName: TOOL_NAME.PLAN_MULTI_TASK_COLLABORATION,
        error: error?.message || String(error),
        hasMarkdownBlock: Boolean(hasMarkdownBlock),
      },
    },
    { workspaceRoot: runtime?.globalConfig?.workspaceRoot },
  );
}

export function createPlanMultiTaskCollaborationTool({ runtime, globalConfig, userConfig }) {
  return new DynamicStructuredTool({
    name: TOOL_NAME.PLAN_MULTI_TASK_COLLABORATION,
    description: tTool(runtime, "tools.agent_collab.planDescription"),
    schema: z.object({
      task: z.string().describe(tTool(runtime, "tools.agent_collab.fieldPlanTask")),
    }),
    func: async ({ task }) => {
      const taskText = String(task || "").trim();
      if (!taskText) {
        throw recoverableToolError(tTool(runtime, "common.taskRequired"), {
          code: ERROR_CODE.RECOVERABLE_INPUT_MISSING,
          details: { field: "task" },
        });
      }

      const runtimeModel = String(runtime?.runtimeModel || "").trim();
      const modelSpec = runtimeModel
        ? resolveModelSpecByName({
            modelName: runtimeModel,
            globalConfig,
            userConfig,
            fallbackToDefault: false,
          })
        : resolveDefaultModelSpec({ globalConfig, userConfig });
      if (!modelSpec) {
        throw new Error(
          runtimeModel
            ? `runtime collaboration model not found: ${runtimeModel}`
            : "collaboration model is not configured",
        );
      }
      const modelPort = runtime?.modelPort;
      if (!modelPort || typeof modelPort.invoke !== "function") {
        throw new Error("collaboration planning requires runtime.modelPort");
      }
      const response = await modelPort.invoke({
        model: modelSpec,
        messages: [
          {
            role: "system",
            content: [
              tTool(runtime, "tools.agent_collab.planPrompt1"),
              tTool(runtime, "tools.agent_collab.planPrompt2"),
              tTool(runtime, "tools.agent_collab.planPrompt3"),
              tTool(runtime, "tools.agent_collab.planPrompt4"),
              tTool(runtime, "tools.agent_collab.planPrompt5"),
            ].join("\n"),
          },
          {
            role: "user",
            content: `${tTool(runtime, "tools.agent_collab.humanTaskPrefix")}\n${taskText}`,
          },
        ],
        options: {
          streaming: false,
          signal: runtime?.abortSignal || undefined,
        },
        invocation: {
          flow: "tool.agent_collab",
          purpose: "collaboration_plan",
          domain: "collaboration",
          contextSequencePolicy: MODEL_CONTEXT_SEQUENCE_POLICY.INDEPENDENT_REQUEST,
        },
      });
      const content = response.output.text;

      let parsedPlan = null;
      try {
        parsedPlan = JSON.parse(content);
      } catch (error) {
        const match = String(content).match(/```json\s*([\s\S]*?)\s*```/i);
        const runtimeEventResult = await recordPlanJsonParseFallback({
          runtime,
          event: "agent.collab.planJsonParse.fallbackToMarkdown",
          error,
          hasMarkdownBlock: Boolean(match?.[1]),
        }).catch(() => ({ ok: false }));
        if (match?.[1]) {
          try {
            parsedPlan = JSON.parse(match[1]);
          } catch (error) {
            const runtimeEventResult = await recordPlanJsonParseFallback({
              runtime,
              event: "agent.collab.planMarkdownJsonParse.failed",
              error,
              hasMarkdownBlock: true,
            }).catch(() => ({ ok: false }));
          }
        }
      }

      return toToolJsonResult(
        TOOL_NAME.PLAN_MULTI_TASK_COLLABORATION,
        {
          ok: true,
          task: taskText,
          model: {
            alias: modelSpec?.alias || "",
            name: modelSpec?.model || "",
          },
          ...(parsedPlan ? { plan: parsedPlan } : { planText: content }),
        },
        true,
      );
    },
  });
}
