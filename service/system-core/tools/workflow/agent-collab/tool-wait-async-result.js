/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { z } from "zod";
import { DynamicStructuredTool } from "@langchain/core/tools";
import { isFatalError, recoverableToolError } from "../../../error/index.js";
import { assertValidParentSessionId } from "../../core/check-tool-input.js";
import { tTool } from "../../core/tool-i18n.js";
import { isPlainObject } from "../../../utils/shared-utils.js";
import { SESSION_ASYNC_STATUS } from "../../../bot-manage/config/constants.js";
import { ERROR_CODE } from "../../../error/constants.js";
import { TOOL_NAME } from "../../constants/index.js";
import {
  buildWaitAsyncTaskResultPayload,
  buildWaitTaskFailedResult,
  buildWaitTaskInvalidResult,
  buildWaitTaskRequest,
  cloneData,
  summarizeAsyncTaskResult,
  summarizeTaskResultsStatus,
} from "./collab-task-utils.js";

export function createWaitAsyncTaskResultTool({
  agentContext,
  runtime,
  botManager,
  userId,
  defaultWaitMs,
  defaultPollIntervalMs,
  patchContainerTaskAndStatus,
  persistCompletedTaskResultsAsAttachments,
  tAgentCollab,
}) {
  return new DynamicStructuredTool({
    name: TOOL_NAME.WAIT_ASYNC_TASK_RESULT,
    description: tTool(runtime, "tools.agent_collab.waitDescription"),
    schema: z.object({
      timeoutMs: z.number().optional().describe(tTool(runtime, "tools.agent_collab.fieldTimeoutMs")),
      pollIntervalMs: z
        .number()
        .optional()
        .describe(tTool(runtime, "tools.agent_collab.fieldPollIntervalMs")),
    }),
    func: async ({ timeoutMs, pollIntervalMs }) => {
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

      const containers = (
        Array.isArray(runtime.childAsyncResultContainers)
          ? runtime.childAsyncResultContainers
          : []
      ).filter((item) => isPlainObject(item) && Array.isArray(item?.tasks));
      if (!containers.length) {
        throw recoverableToolError(
          tAgentCollab(runtime, "childAsyncResultContainersRequired"),
          {
            code: ERROR_CODE.RECOVERABLE_INPUT_MISSING,
            details: { field: "childAsyncResultContainers" },
          },
        );
      }

      const normalizedTimeoutMs = Number(timeoutMs);
      const resolvedTimeoutMs =
        Number.isFinite(normalizedTimeoutMs) && normalizedTimeoutMs > 0
          ? Math.floor(normalizedTimeoutMs)
          : defaultWaitMs;

      const normalizedPollIntervalMs = Number(pollIntervalMs);
      const resolvedPollIntervalMs =
        Number.isFinite(normalizedPollIntervalMs) && normalizedPollIntervalMs > 0
          ? Math.floor(normalizedPollIntervalMs)
          : Math.max(1000, Math.floor(defaultPollIntervalMs || 5000));

      const singleWaitMs = Math.max(1000, resolvedTimeoutMs);
      const containerResults = await Promise.all(
        containers.map(async (containerItem = {}) => {
          const containerId = String(containerItem?.id || "").trim();
          const resolvedParentSessionId = String(
            containerItem?.parentSessionId || "",
          ).trim();
          if (!resolvedParentSessionId) {
            return {
              id: containerId,
              ok: false,
              status: SESSION_ASYNC_STATUS.INVALID_REQUEST,
              error: tAgentCollab(runtime, "parentSessionIdRequired"),
              tasks: [],
            };
          }

          const normalizedParentSessionId = await assertValidParentSessionId({
            parentSessionId: resolvedParentSessionId,
            agentContext,
          });

          const taskList = Array.isArray(containerItem?.tasks) ? containerItem.tasks : [];
          const taskResults = await Promise.all(
            taskList.map(async (taskItem = {}, index) => {
              const request = buildWaitTaskRequest({
                sessionId: taskItem?.sessionId,
                taskName: taskItem?.taskName,
                taskContent: taskItem?.taskContent,
              });
              const normalizedSessionId = request.sessionId;
              if (!request.sessionId || !request.taskName || !request.taskContent) {
                return buildWaitTaskInvalidResult({
                  index,
                  request,
                  error: tAgentCollab(runtime, "taskNameTaskContentRequired"),
                });
              }
              try {
                const result = await botManager.waitAsyncSession({
                  userId,
                  parentSessionId: normalizedParentSessionId,
                  sessionId: normalizedSessionId,
                  timeoutMs: singleWaitMs,
                });
                return {
                  ...result,
                  rawResult: cloneData(result?.result ?? null),
                  result: summarizeAsyncTaskResult(result?.result),
                  index,
                  request,
                };
              } catch (error) {
                if (isFatalError(error)) throw error;
                return buildWaitTaskFailedResult({
                  index,
                  request,
                  error: error?.message || String(error),
                });
              }
            }),
          );

          for (const item of taskResults) {
            patchContainerTaskAndStatus({
              container: containerItem,
              sessionId: String(item?.request?.sessionId || ""),
              patch: {
                status: String(item?.status || SESSION_ASYNC_STATUS.RUNNING),
                startedAt: String(item?.startedAt || "").trim(),
                endedAt: String(item?.endedAt || "").trim(),
                error: String(item?.error || "").trim(),
                result: item?.result ?? null,
              },
            });
          }

          const status = summarizeTaskResultsStatus(taskResults);
          const attachmentMetas = await persistCompletedTaskResultsAsAttachments({
            container: containerItem,
            taskResults,
          });

          return {
            id: containerId,
            parentSessionId: normalizedParentSessionId,
            ok: status !== SESSION_ASYNC_STATUS.FAILED,
            status,
            tasks: taskResults,
            attachmentMetas,
          };
        }),
      );

      const allTaskResults = containerResults.flatMap((item) =>
        Array.isArray(item?.tasks) ? item.tasks : [],
      );
      const containerStatuses = containerResults.map((item) => ({
        id: String(item?.id || "").trim(),
        parentSessionId: String(item?.parentSessionId || "").trim(),
        status: String(item?.status || "").trim(),
        ok: item?.ok !== false,
      }));
      const taskStats = {
        total: allTaskResults.length,
        completed: allTaskResults.filter(
          (item) => String(item?.status || "") === SESSION_ASYNC_STATUS.COMPLETED,
        ).length,
        running: allTaskResults.filter(
          (item) => String(item?.status || "") === SESSION_ASYNC_STATUS.RUNNING,
        ).length,
        failed: allTaskResults.filter(
          (item) => String(item?.status || "") === SESSION_ASYNC_STATUS.FAILED,
        ).length,
        stopped: allTaskResults.filter(
          (item) => String(item?.status || "") === SESSION_ASYNC_STATUS.STOPPED,
        ).length,
        invalid_request: allTaskResults.filter(
          (item) =>
            String(item?.status || "") === SESSION_ASYNC_STATUS.INVALID_REQUEST,
        ).length,
      };
      const attachmentMetas = containerResults.flatMap((item) =>
        Array.isArray(item?.attachmentMetas) ? item.attachmentMetas : [],
      );

      const hasFailedTask = containerResults.some((item) => {
        const status = String(item?.status || "").trim();
        return (
          status === SESSION_ASYNC_STATUS.FAILED ||
          status === SESSION_ASYNC_STATUS.INVALID_REQUEST ||
          item?.ok === false
        );
      });
      if (hasFailedTask) {
        return buildWaitAsyncTaskResultPayload({
          ok: false,
          status: SESSION_ASYNC_STATUS.FAILED,
          nextPollInMs: resolvedPollIntervalMs,
          containers,
          containerStatuses,
          taskStats,
          attachmentMetas,
        });
      }

      const hasStoppedTask = containerResults.some(
        (item) => String(item?.status || "") === SESSION_ASYNC_STATUS.STOPPED,
      );
      if (hasStoppedTask) {
        return buildWaitAsyncTaskResultPayload({
          ok: true,
          status: SESSION_ASYNC_STATUS.STOPPED,
          nextPollInMs: resolvedPollIntervalMs,
          containers,
          containerStatuses,
          taskStats,
          attachmentMetas,
        });
      }

      const allCompleted = containerResults.every(
        (item) => String(item?.status || "") === SESSION_ASYNC_STATUS.COMPLETED,
      );
      if (!allCompleted) {
        return buildWaitAsyncTaskResultPayload({
          ok: true,
          status: SESSION_ASYNC_STATUS.RUNNING,
          nextPollInMs: resolvedPollIntervalMs,
          containers,
          containerStatuses,
          taskStats,
          attachmentMetas,
        });
      }

      return buildWaitAsyncTaskResultPayload({
        ok: true,
        status: SESSION_ASYNC_STATUS.COMPLETED,
        nextPollInMs: 0,
        containers,
        containerStatuses,
        taskStats,
        attachmentMetas,
      });
    },
  });
}
