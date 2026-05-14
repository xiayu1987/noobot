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
    name: "wait_async_task_result",
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
            code: "RECOVERABLE_RUNTIME_MISSING",
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
            code: "RECOVERABLE_INPUT_MISSING",
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
              status: "invalid_request",
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
                status: String(item?.status || "running"),
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
            ok: status !== "failed",
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
          (item) => String(item?.status || "") === "completed",
        ).length,
        running: allTaskResults.filter(
          (item) => String(item?.status || "") === "running",
        ).length,
        failed: allTaskResults.filter(
          (item) => String(item?.status || "") === "failed",
        ).length,
        stopped: allTaskResults.filter(
          (item) => String(item?.status || "") === "stopped",
        ).length,
        invalid_request: allTaskResults.filter(
          (item) => String(item?.status || "") === "invalid_request",
        ).length,
      };
      const attachmentMetas = containerResults.flatMap((item) =>
        Array.isArray(item?.attachmentMetas) ? item.attachmentMetas : [],
      );

      const hasFailedTask = containerResults.some((item) => {
        const status = String(item?.status || "").trim();
        return status === "failed" || status === "invalid_request" || item?.ok === false;
      });
      if (hasFailedTask) {
        return buildWaitAsyncTaskResultPayload({
          ok: false,
          status: "failed",
          nextPollInMs: resolvedPollIntervalMs,
          containers,
          containerStatuses,
          taskStats,
          attachmentMetas,
        });
      }

      const hasStoppedTask = containerResults.some(
        (item) => String(item?.status || "") === "stopped",
      );
      if (hasStoppedTask) {
        return buildWaitAsyncTaskResultPayload({
          ok: true,
          status: "stopped",
          nextPollInMs: resolvedPollIntervalMs,
          containers,
          containerStatuses,
          taskStats,
          attachmentMetas,
        });
      }

      const allCompleted = containerResults.every(
        (item) => String(item?.status || "") === "completed",
      );
      if (!allCompleted) {
        return buildWaitAsyncTaskResultPayload({
          ok: true,
          status: "running",
          nextPollInMs: resolvedPollIntervalMs,
          containers,
          containerStatuses,
          taskStats,
          attachmentMetas,
        });
      }

      return buildWaitAsyncTaskResultPayload({
        ok: true,
        status: "completed",
        nextPollInMs: 0,
        containers,
        containerStatuses,
        taskStats,
        attachmentMetas,
      });
    },
  });
}
