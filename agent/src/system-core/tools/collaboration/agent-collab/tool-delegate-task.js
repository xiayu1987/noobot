/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { DynamicStructuredTool } from "@langchain/core/tools";
import { emitEvent } from "../../../event/index.js";
import { isFatalError, recoverableToolError } from "../../../error/index.js";
import { assertValidParentDialogProcessId } from "../../core/check-tool-input.js";
import { toToolJsonResult } from "../../core/tool-json-result.js";
import { tTool } from "../../core/tool-i18n.js";
import { ERROR_CODE } from "../../../error/constants.js";
import { TOOL_NAME, TOOL_RESULT_STATUS } from "../../constants/index.js";
import { hasOwnConfigKey } from "../../../config/index.js";
import {
  buildDelegateTaskFailureResult,
  cloneData,
  toTaskRequest,
} from "./collab-task-utils.js";

export function createDelegateTaskTool({
  agentContext,
  runtime,
  sourceSessionId,
  sourceDialogProcessId,
  botManager,
  userId,
  runtimeEventListener,
  passthroughToolPolicy,
  runConfig,
  userInteractionBridge,
  abortSignal,
  addChildAsyncResultContainer,
  createChildAsyncResultContainer,
  patchContainerTaskAndStatus,
  nowIso,
  tAgentCollab,
}) {
  const delegateTaskItemSchema = z.object({
    taskName: z.string().describe(tTool(runtime, "tools.agent_collab.fieldTaskName")),
    taskContent: z.string().describe(tTool(runtime, "tools.agent_collab.fieldTaskContent")),
  });

  return new DynamicStructuredTool({
    name: TOOL_NAME.DELEGATE_TASK_ASYNC,
    description: tTool(runtime, "tools.agent_collab.delegateDescription"),
    schema: z.object({
      tasks: z.array(delegateTaskItemSchema).min(1).describe(tTool(runtime, "tools.agent_collab.fieldTasks")),
    }),
    func: async ({ tasks }) => {
      if (!botManager || !userId) {
        throw recoverableToolError(
          tAgentCollab(runtime, "runtimeMissingBotManagerUserId"),
          {
            code: ERROR_CODE.RECOVERABLE_RUNTIME_MISSING,
            details: {
              botManagerReady: Boolean(botManager),
              userIdReady: Boolean(userId),
            },
          },
        );
      }

      emitEvent(runtimeEventListener, "subagent_runconfig_passthrough_applied", {
        sourceTool: TOOL_NAME.DELEGATE_TASK_ASYNC,
        passthrough: {
          toolPolicy: passthroughToolPolicy,
          streaming: hasOwnConfigKey(runConfig, "streaming"),
        },
        effectiveRunConfig: {
          safeConfirm: runConfig?.safeConfirm !== false,
          ...(hasOwnConfigKey(runConfig, "streaming") ? { streaming: runConfig.streaming } : {}),
          hasToolPolicy: runConfig?.toolPolicy && typeof runConfig.toolPolicy === "object",
          toolPolicyKeys:
            runConfig?.toolPolicy && typeof runConfig.toolPolicy === "object"
              ? Object.keys(runConfig.toolPolicy)
              : [],
        },
        taskCount: Array.isArray(tasks) ? tasks.length : 0,
      });

      const resolveValidatedParent = async () => {
        const normalizedParentSessionId = String(sourceSessionId || "").trim();
        if (!normalizedParentSessionId) {
          throw recoverableToolError(tAgentCollab(runtime, "runtimeSessionIdMissing"), {
            code: ERROR_CODE.RECOVERABLE_INPUT_MISSING,
            details: {
              field: "runtime.systemRuntime.sessionId",
              hint: tAgentCollab(runtime, "sessionContextHint"),
            },
          });
        }
        const normalizedParentDialogProcessId = String(sourceDialogProcessId || "").trim();
        if (!normalizedParentDialogProcessId) {
          throw recoverableToolError(
            tAgentCollab(runtime, "runtimeDialogProcessIdMissing"),
            {
              code: ERROR_CODE.RECOVERABLE_INPUT_MISSING,
              details: {
                field: "runtime.systemRuntime.dialogProcessId",
                hint: tAgentCollab(runtime, "dialogContextHint"),
              },
            },
          );
        }
        return assertValidParentDialogProcessId({
          parentSessionId: normalizedParentSessionId,
          parentDialogProcessId: normalizedParentDialogProcessId,
          agentContext,
        });
      };

      const validatedParent = await resolveValidatedParent();
      const normalizedParentSessionId = validatedParent.parentSessionId;
      const normalizedParentDialogProcessId = validatedParent.parentDialogProcessId;

      if (!Array.isArray(tasks) || !tasks.length) {
        throw recoverableToolError(tAgentCollab(runtime, "tasksRequired"), {
          code: ERROR_CODE.RECOVERABLE_INPUT_MISSING,
          details: { field: "tasks" },
        });
      }

      const resultList = await Promise.all(
        tasks.map(async (taskItem = {}, index) => {
          const generatedSessionId = randomUUID();
          const request = toTaskRequest(taskItem, generatedSessionId);
          const taskName = request.taskName;
          const taskContent = request.taskContent;
          const taskText = [taskName, taskContent].filter(Boolean).join("\n");
          const childContainer = createChildAsyncResultContainer({
            parentSessionId: normalizedParentSessionId,
            parentDialogProcessId: normalizedParentDialogProcessId,
            request,
          });

          if (!taskName || !taskContent) {
            patchContainerTaskAndStatus({
              container: childContainer,
              sessionId: generatedSessionId,
              patch: {
                status: TOOL_RESULT_STATUS.FAILED,
                error: tAgentCollab(runtime, "taskNameTaskContentRequired"),
                endedAt: nowIso(),
              },
            });
            return buildDelegateTaskFailureResult({
              index,
              error: tAgentCollab(runtime, "taskNameTaskContentRequired"),
              parentAsyncResultContainer: childContainer,
              request,
            });
          }

          try {
            const result = botManager.runAsyncSession({
              userId,
              parentSessionId: normalizedParentSessionId,
              sessionId: generatedSessionId,
              task: taskText,
              sharedTaskSpec: "",
              eventListener: runtimeEventListener,
              sourceDialogProcessId: String(sourceDialogProcessId || ""),
              parentDialogProcessId: normalizedParentDialogProcessId,
              userInteractionBridge,
              runConfig,
              abortSignal,
              parentAsyncResultContainer: childContainer,
            });
            const resolvedContainer = addChildAsyncResultContainer(
              result?.parentAsyncResultContainer || childContainer,
            );
            if (resolvedContainer) {
              runtime.parentAsyncResultContainer = resolvedContainer;
            }
            return {
              ok: true,
              index,
              ...result,
              parentAsyncResultContainer: resolvedContainer || childContainer || null,
              request,
            };
          } catch (error) {
            if (isFatalError(error)) throw error;
            patchContainerTaskAndStatus({
              container: childContainer,
              sessionId: generatedSessionId,
              patch: {
                status: TOOL_RESULT_STATUS.FAILED,
                error: error?.message || String(error),
                endedAt: nowIso(),
              },
            });
            return buildDelegateTaskFailureResult({
              index,
              error: error?.message || String(error),
              parentAsyncResultContainer: childContainer,
              request,
            });
          }
        }),
      );

      const createdContainers = resultList
        .map((item = {}) => addChildAsyncResultContainer(item?.parentAsyncResultContainer))
        .filter(Boolean);
      const allOk = resultList.every((item) => item?.ok);
      return toToolJsonResult(
        TOOL_NAME.DELEGATE_TASK_ASYNC,
        {
          ok: allOk,
          status: allOk ? "running" : "partial_failed",
          parentSessionId: normalizedParentSessionId,
          parentDialogProcessId: normalizedParentDialogProcessId,
          child_async_result_containers: cloneData(createdContainers),
          tasks: resultList,
        },
        true,
      );
    },
  });
}
