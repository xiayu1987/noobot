/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { DynamicStructuredTool } from "@langchain/core/tools";
import { HumanMessage, SystemMessage } from "@langchain/core/messages";
import { Buffer } from "node:buffer";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { mergeConfig } from "../config/index.js";
import { mapAttachmentRecordsToMetas } from "../attach/index.js";
import {
  createChatModel,
  createChatModelByName,
  resolveDefaultModelSpec,
  resolveModelSpecByName,
} from "../model/index.js";
import {
  isFatalError,
  recoverableToolError,
} from "../error/index.js";
import {
  assertValidParentDialogProcessId,
  assertValidParentSessionId,
} from "./check-tool-input.js";
import { toToolJsonResult } from "./tool-json-result.js";

function getRuntime(agentContext) {
  return agentContext?.runtime || {};
}

function isPlainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function cloneData(value) {
  if (typeof globalThis.structuredClone === "function") {
    try {
      return globalThis.structuredClone(value);
    } catch {}
  }
  try {
    return JSON.parse(JSON.stringify(value));
  } catch {
    return value;
  }
}

function normalizeString(value = "") {
  return String(value || "").trim();
}
export function createAgentCollabTool({ agentContext }) {
  const runtime = getRuntime(agentContext);
  const systemRuntime = runtime.systemRuntime || {};
  const runConfig = {
    allowUserInteraction: systemRuntime?.config?.allowUserInteraction !== false,
  };
  const botManager = runtime.botManager || null;
  const userId = agentContext?.userId || runtime.userId || "";
  const runtimeEventListener = runtime.eventListener || null;
  const abortSignal = runtime.abortSignal || null;
  const userInteractionBridge = runtime.userInteractionBridge || null;
  const sourceDialogProcessId = systemRuntime.dialogProcessId || "";
  const rootSessionId = String(systemRuntime?.rootSessionId || "").trim();
  const globalConfig = runtime.globalConfig || {};
  const userConfig = runtime.userConfig || {};
  const attachmentService = runtime.attachmentService || null;
  const effectiveConfig = mergeConfig(globalConfig, userConfig);
  const defaultWaitMs = Number(
    effectiveConfig?.tools?.wait_async_task_result?.wait_timeout_ms ??
      effectiveConfig?.tools?.wait_async_task_result?.waitTimeoutMs ??
      effectiveConfig?.tools?.delegate_task_async?.wait_timeout_ms ??
      effectiveConfig?.tools?.delegate_task_async?.waitTimeoutMs ??
      effectiveConfig?.tools?.agent_collab?.wait_timeout_ms ??
      effectiveConfig?.tools?.agent_collab?.waitTimeoutMs ??
      120000,
  );
  const defaultPollIntervalMs = Number(
    effectiveConfig?.tools?.wait_async_task_result?.poll_interval_ms ??
      effectiveConfig?.tools?.wait_async_task_result?.pollIntervalMs ??
      effectiveConfig?.tools?.delegate_task_async?.poll_interval_ms ??
      effectiveConfig?.tools?.delegate_task_async?.pollIntervalMs ??
      5000,
  );
  runtime.childAsyncResultContainers = Array.isArray(
    runtime.childAsyncResultContainers,
  )
    ? runtime.childAsyncResultContainers
    : [];
  runtime.sharedTools =
    runtime.sharedTools && typeof runtime.sharedTools === "object"
      ? runtime.sharedTools
      : {};
  const getAsyncResultContainerStore = () => {
    if (!(runtime.sharedTools.asyncResultContainers instanceof Map)) {
      runtime.sharedTools.asyncResultContainers = new Map();
    }
    return runtime.sharedTools.asyncResultContainers;
  };
  const upsertAsyncResultContainer = (container = {}) => {
    if (!isPlainObject(container)) return null;
    const containerId = String(container?.id || "").trim();
    if (!containerId) return null;
    const normalized = {
      id: containerId,
      parentSessionId: String(container?.parentSessionId || "").trim(),
      parentDialogProcessId: String(
        container?.parentDialogProcessId || "",
      ).trim(),
      status: String(container?.status || "running").trim() || "running",
      updatedAt: String(container?.updatedAt || new Date().toISOString()),
      tasks: Array.isArray(container?.tasks)
        ? container.tasks.map((item = {}, index) => ({
            index,
            sessionId: String(item?.sessionId || "").trim(),
            taskName: String(item?.taskName || "").trim(),
            taskContent: String(item?.taskContent || "").trim(),
            deliverable: String(item?.deliverable || "").trim(),
            status: String(item?.status || "running").trim() || "running",
            startedAt: String(item?.startedAt || "").trim(),
            endedAt: String(item?.endedAt || "").trim(),
            error: String(item?.error || "").trim(),
            result: item?.result ?? null,
            attachmentId: String(item?.attachmentId || "").trim(),
            attachmentName: String(item?.attachmentName || "").trim(),
          }))
        : [],
    };
    const store = getAsyncResultContainerStore();
    store.set(containerId, normalized);
    return normalized;
  };
  const patchAsyncResultTask = ({
    containerId = "",
    sessionId = "",
    patch = {},
  } = {}) => {
    const normalizedContainerId = String(containerId || "").trim();
    const normalizedSessionId = String(sessionId || "").trim();
    if (!normalizedContainerId || !normalizedSessionId || !isPlainObject(patch))
      return null;
    const store = getAsyncResultContainerStore();
    const existing = store.get(normalizedContainerId);
    if (!isPlainObject(existing) || !Array.isArray(existing.tasks)) return null;
    const targetIndex = existing.tasks.findIndex(
      (item) => String(item?.sessionId || "").trim() === normalizedSessionId,
    );
    if (targetIndex < 0) return null;
    existing.tasks[targetIndex] = {
      ...(existing.tasks[targetIndex] || {}),
      ...patch,
    };
    existing.updatedAt = new Date().toISOString();
    store.set(normalizedContainerId, existing);
    return cloneData(existing.tasks[targetIndex]);
  };
  const updateContainerStatusByTasks = (container = {}) => {
    if (!isPlainObject(container)) return "unknown";
    const taskList = Array.isArray(container.tasks) ? container.tasks : [];
    if (!taskList.length) return "running";
    if (taskList.some((task) => String(task?.status || "") === "failed")) {
      return "failed";
    }
    if (taskList.every((task) => String(task?.status || "") === "completed")) {
      return "completed";
    }
    if (taskList.some((task) => String(task?.status || "") === "stopped")) {
      return "stopped";
    }
    return "running";
  };
  const nowIso = () => new Date().toISOString();
  const toTaskRequest = (taskItem = {}, sessionId = "") => ({
    sessionId: String(sessionId || "").trim(),
    taskName: String(taskItem?.taskName || "").trim(),
    taskContent: String(taskItem?.taskContent || "").trim(),
  });
  const createChildAsyncResultContainer = ({
    parentSessionId = "",
    parentDialogProcessId = "",
    request = {},
  } = {}) => {
    const container = upsertAsyncResultContainer({
      id: randomUUID(),
      parentSessionId,
      parentDialogProcessId,
      status: "running",
      updatedAt: nowIso(),
      tasks: [
        {
          index: 0,
          sessionId: String(request?.sessionId || "").trim(),
          taskName: String(request?.taskName || "").trim(),
          taskContent: String(request?.taskContent || "").trim(),
          status: "running",
          startedAt: "",
          endedAt: "",
          error: "",
          result: null,
          attachmentId: "",
          attachmentName: "",
        },
      ],
    });
    return addChildAsyncResultContainer(container);
  };
  const patchContainerTaskAndStatus = ({
    container = null,
    sessionId = "",
    patch = {},
  } = {}) => {
    if (!isPlainObject(container)) return;
    patchAsyncResultTask({
      containerId: String(container?.id || ""),
      sessionId,
      patch,
    });
    container.status = updateContainerStatusByTasks(container);
    container.updatedAt = nowIso();
  };
  const summarizeTaskResultsStatus = (taskResults = []) => {
    const failed = taskResults.some(
      (item) => String(item?.status || "") === "failed" || item?.ok === false,
    );
    if (failed) return "failed";
    const stopped = taskResults.some(
      (item) => String(item?.status || "") === "stopped",
    );
    if (stopped) return "stopped";
    const completed = taskResults.every(
      (item) => String(item?.status || "") === "completed",
    );
    return completed ? "completed" : "running";
  };
  const buildWaitTaskRequest = ({
    sessionId = "",
    taskName = "",
    taskContent = "",
  } = {}) => ({
    sessionId: normalizeString(sessionId),
    taskName: normalizeString(taskName),
    taskContent: normalizeString(taskContent),
  });
  const buildDelegateTaskFailureResult = ({
    index = 0,
    error = "",
    request = {},
    parentAsyncResultContainer = null,
  } = {}) => ({
    ok: false,
    index,
    error: normalizeString(error),
    parentAsyncResultContainer: parentAsyncResultContainer || null,
    request: {
      ...request,
    },
  });
  const buildWaitTaskInvalidResult = ({
    index = 0,
    request = {},
    error = "sessionId/taskName/taskContent required",
  } = {}) => ({
    ok: false,
    index,
    status: "invalid_request",
    error: normalizeString(error),
    request,
  });
  const buildWaitTaskFailedResult = ({
    index = 0,
    request = {},
    error = "",
  } = {}) => ({
    ok: false,
    index,
    status: "failed",
    error: normalizeString(error),
    request,
  });
  const buildWaitAsyncTaskResultPayload = ({
    ok = true,
    status = "running",
    nextPollInMs = 0,
    containers = [],
    containerStatuses = [],
    taskStats = {},
    attachmentMetas = [],
  } = {}) =>
    toToolJsonResult(
      "wait_async_task_result",
      {
        ok,
        status,
        checked_at: nowIso(),
        next_poll_in_ms: nextPollInMs,
        child_async_result_containers: cloneData(containers),
        container_statuses: containerStatuses,
        task_stats: taskStats,
        attachmentMetas,
      },
      true,
    );
  const summarizeAsyncTaskResult = (result = null) => {
    if (!result || typeof result !== "object") return null;
    const answer = String(result?.answer || "").trim();
    return {
      sessionId: String(result?.sessionId || "").trim(),
      parentSessionId: String(result?.parentSessionId || "").trim(),
      parentDialogProcessId: String(result?.parentDialogProcessId || "").trim(),
      dialogProcessId: String(result?.dialogProcessId || "").trim(),
      answer,
      hasAnswer: Boolean(answer),
      messageCount: Array.isArray(result?.messages) ? result.messages.length : 0,
      traceCount: Array.isArray(result?.traces) ? result.traces.length : 0,
      turnTaskCount: Array.isArray(result?.turnTasks) ? result.turnTasks.length : 0,
    };
  };
  const toSafeArtifactName = (value = "") =>
    String(value || "")
      .replace(/[\\/:*?"<>|]+/g, "_")
      .replace(/\s+/g, "_")
      .slice(0, 80);
  const toFinalResultMarkdownText = (taskResultItem = {}) => {
    const rawResult = taskResultItem?.rawResult ?? taskResultItem?.result ?? null;
    const answer = String(rawResult?.answer || "").trim();
    if (answer) return answer;
    if (typeof rawResult === "string") return String(rawResult || "").trim();
    if (rawResult && typeof rawResult === "object") {
      try {
        return JSON.stringify(rawResult, null, 2);
      } catch {}
    }
    const fallbackError = String(taskResultItem?.error || "").trim();
    if (fallbackError) return fallbackError;
    return String(taskResultItem?.status || "").trim() || "(无结果)";
  };
  const persistCompletedTaskResultsAsAttachments = async ({
    container = {},
    taskResults = [],
  } = {}) => {
    if (!attachmentService || !userId) return [];
    const parentSessionId = String(container?.parentSessionId || "").trim();
    const attachmentSessionId = String(
      runtime?.systemRuntime?.rootSessionId ||
        runtime?.systemRuntime?.sessionId ||
        rootSessionId ||
        parentSessionId ||
        "",
    ).trim();
    if (!attachmentSessionId) return [];
    const taskList = Array.isArray(container?.tasks) ? container.tasks : [];
    const attachedSessionIdSet = new Set(
      taskList
        .filter((taskItem) => normalizeString(taskItem?.attachmentId))
        .map((taskItem) => normalizeString(taskItem?.sessionId))
        .filter(Boolean),
    );
    const pendingItems = (Array.isArray(taskResults) ? taskResults : []).filter(
      (item = {}) => {
        const status = normalizeString(item?.status);
        const sessionId = normalizeString(item?.request?.sessionId);
        if (!sessionId) return false;
        if (!["completed", "failed", "stopped"].includes(status)) return false;
        return !attachedSessionIdSet.has(sessionId);
      },
    );
    if (!pendingItems.length) return [];
    const generatedAttachments = pendingItems.map((item = {}, index) => {
      const status = String(item?.status || "").trim() || "running";
      const taskName = normalizeString(item?.request?.taskName);
      const sessionId = normalizeString(item?.request?.sessionId);
      const fileLabel =
        toSafeArtifactName(taskName) || toSafeArtifactName(sessionId) || `task_${index + 1}`;
      const markdownText = toFinalResultMarkdownText(item);
      return {
        __sessionId: sessionId,
        name: `subtask-${fileLabel}-${status}.md`,
        mimeType: "text/markdown",
        contentBase64: Buffer.from(markdownText || "(无结果)", "utf8").toString("base64"),
      };
    });
    let attachmentMetas = [];
    try {
      const savedRecords = await attachmentService.ingestGeneratedArtifacts({
        userId,
        sessionId: attachmentSessionId,
        attachmentSource: "subtask",
        generationSource: "async_subtask_result",
        artifacts: generatedAttachments,
      });
      attachmentMetas = mapAttachmentRecordsToMetas(savedRecords, {
        fallbackMimeType: "text/markdown",
        fallbackGenerationSource: "async_subtask_result",
      });
    } catch {
      return [];
    }
    for (let index = 0; index < attachmentMetas.length; index += 1) {
      const meta = attachmentMetas[index] || {};
      const artifact = generatedAttachments[index] || {};
      const sessionId = String(artifact?.__sessionId || "").trim();
      if (!sessionId) continue;
      patchAsyncResultTask({
        containerId: String(container?.id || "").trim(),
        sessionId,
        patch: {
          attachmentId: String(meta?.attachmentId || "").trim(),
          attachmentName: String(meta?.name || artifact?.name || "").trim(),
        },
      });
    }
    return attachmentMetas;
  };
  const addChildAsyncResultContainer = (container = {}) => {
    if (!isPlainObject(container)) return null;
    const normalized = upsertAsyncResultContainer(container) || container;
    const containerId = String(normalized?.id || "").trim();
    if (!containerId) return null;
    const list = runtime.childAsyncResultContainers;
    const hitIndex = list.findIndex(
      (item) => String(item?.id || "").trim() === containerId,
    );
    if (hitIndex >= 0) {
      list[hitIndex] = normalized;
    } else {
      list.push(normalized);
    }
    return normalized;
  };

  const delegateTaskItemSchema = z.object({
    taskName: z.string().describe("子任务名称"),
    taskContent: z.string().describe("子任务内容"),
  });

  const delegateTaskAsync = new DynamicStructuredTool({
    name: "delegate_task_async",
    description:
      "多agent协助：异步并发执行多个子任务。传入父sessionid和tasks数组，每个task中包含taskName、taskContent。汇总结果并返回。",
    schema: z.object({
      parentSessionId: z.string().describe("父会话ID（UUID）"),
      parentDialogProcessId: z
        .string()
        .describe(
          "父会话中的对话流程ID（必须存在于 parentSessionId 的消息中）",
        ),
      tasks: z.array(delegateTaskItemSchema).min(1).describe("并发子任务列表"),
    }),
    func: async ({ parentSessionId, parentDialogProcessId, tasks }) => {
      if (!botManager || !userId)
        return toToolJsonResult("delegate_task_async", {
          ok: false,
          error: "runtime missing bot manager/user id",
        });
      const validatedParent = await assertValidParentDialogProcessId({
        parentSessionId,
        parentDialogProcessId,
        agentContext,
      });
      const normalizedParentSessionId = validatedParent.parentSessionId;
      const normalizedParentDialogProcessId =
        validatedParent.parentDialogProcessId;
      if (!Array.isArray(tasks) || !tasks.length) {
        throw recoverableToolError("tasks required", {
          code: "RECOVERABLE_INPUT_MISSING",
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
                status: "failed",
                error: "taskName/taskContent required",
                endedAt: nowIso(),
              },
            });
            return buildDelegateTaskFailureResult({
              index,
              error: "taskName/taskContent required",
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
              parentAsyncResultContainer:
                resolvedContainer || childContainer || null,
              request,
            };
          } catch (error) {
            if (isFatalError(error)) throw error;
            patchContainerTaskAndStatus({
              container: childContainer,
              sessionId: generatedSessionId,
              patch: {
                status: "failed",
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
        .map((item = {}) =>
          addChildAsyncResultContainer(item?.parentAsyncResultContainer),
        )
        .filter(Boolean);
      const allOk = resultList.every((item) => item?.ok);
      return toToolJsonResult(
        "delegate_task_async",
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

  const waitAsyncTaskResult = new DynamicStructuredTool({
    name: "wait_async_task_result",
    description:
      "并发等待当前上下文中 childAsyncResultContainers 的全部异步子任务结果。可选 timeoutMs。",
    schema: z.object({
      timeoutMs: z.number().optional().describe("最大等待毫秒数（可选）"),
      pollIntervalMs: z
        .number()
        .optional()
        .describe("轮询间隔毫秒数（可选，默认 5000ms）"),
    }),
    func: async ({ timeoutMs, pollIntervalMs }) => {
      if (!botManager || !userId)
        return toToolJsonResult("wait_async_task_result", {
          ok: false,
          error: "runtime missing bot manager/user id",
        });
      const containers = (
        Array.isArray(runtime.childAsyncResultContainers)
          ? runtime.childAsyncResultContainers
          : []
      ).filter((item) => isPlainObject(item) && Array.isArray(item?.tasks));
      if (!containers.length) {
        throw recoverableToolError("childAsyncResultContainers required", {
          code: "RECOVERABLE_INPUT_MISSING",
          details: { field: "childAsyncResultContainers" },
        });
      }
      const normalizedTimeoutMs = Number(timeoutMs);
      const resolvedTimeoutMs =
        Number.isFinite(normalizedTimeoutMs) && normalizedTimeoutMs > 0
          ? Math.floor(normalizedTimeoutMs)
          : defaultWaitMs;
      const normalizedPollIntervalMs = Number(pollIntervalMs);
      const resolvedPollIntervalMs =
        Number.isFinite(normalizedPollIntervalMs) &&
        normalizedPollIntervalMs > 0
          ? Math.floor(normalizedPollIntervalMs)
          : Math.max(1000, Math.floor(defaultPollIntervalMs || 5000));
      const singleWaitMs = Math.max(
        1000,
        Math.min(resolvedTimeoutMs, resolvedPollIntervalMs),
      );
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
              error: "parentSessionId required",
              tasks: [],
            };
          }
          const normalizedParentSessionId = await assertValidParentSessionId({
            parentSessionId: resolvedParentSessionId,
            agentContext,
          });
          const taskList = Array.isArray(containerItem?.tasks)
            ? containerItem.tasks
            : [];
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
      };
      const attachmentMetas = containerResults.flatMap((item) =>
        Array.isArray(item?.attachmentMetas) ? item.attachmentMetas : [],
      );
      const hasFailedTask = containerResults.some(
        (item) => String(item?.status || "") === "failed",
      );
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

  const planMultiTaskCollaboration = new DynamicStructuredTool({
    name: "plan_multi_task_collaboration",
    description: "多任务协作规划",
    schema: z.object({
      task: z.string().describe("需要拆分流程的任务文本"),
    }),
    func: async ({ task }) => {
      const taskText = String(task || "").trim();
      if (!taskText)
        return toToolJsonResult("plan_multi_task_collaboration", {
          ok: false,
          error: "task required",
        });

      const runtimeModel = String(runtime?.runtimeModel || "").trim();
      let llm;
      let modelSpec = null;
      if (runtimeModel) {
        modelSpec = resolveModelSpecByName({
          modelName: runtimeModel,
          globalConfig,
          userConfig,
          fallbackToDefault: false,
        });
        if (modelSpec) {
          llm = createChatModelByName(runtimeModel, {
            globalConfig,
            userConfig,
            streaming: false,
          });
        }
      }
      if (!llm) {
        modelSpec = resolveDefaultModelSpec({ globalConfig, userConfig });
        llm = createChatModel({ globalConfig, userConfig, streaming: false });
      }

      const res = await llm.invoke([
        new SystemMessage(
          [
            "多任务协作规划。",
            "请输出规划内容与任务调用链。",
            "输出必须是 JSON，不要使用 markdown 代码块。",
            "JSON 格式：",
            '{ "tasks":[{ "taskName":"任务a", "taskContent":"任务目标、内容","subTasks":[] }] }',
          ].join("\n"),
        ),
        new HumanMessage(`任务文本：\n${taskText}`),
      ]);
      const content =
        typeof res?.content === "string"
          ? res.content
          : JSON.stringify(res?.content || "");

      let parsedPlan = null;
      try {
        parsedPlan = JSON.parse(content);
      } catch {
        const match = String(content).match(/```json\s*([\s\S]*?)\s*```/i);
        if (match?.[1]) {
          try {
            parsedPlan = JSON.parse(match[1]);
          } catch {}
        }
      }

      return toToolJsonResult(
        "plan_multi_task_collaboration",
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

  return [
    delegateTaskAsync,
    waitAsyncTaskResult,
    planMultiTaskCollaboration,
  ];
}
