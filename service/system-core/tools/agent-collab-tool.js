/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { DynamicStructuredTool } from "@langchain/core/tools";
import { HumanMessage, SystemMessage } from "@langchain/core/messages";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { mergeConfig } from "../config/index.js";
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
  const globalConfig = runtime.globalConfig || {};
  const userConfig = runtime.userConfig || {};
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
            task: String(item?.task || "").trim(),
            sharedTaskSpec: String(item?.sharedTaskSpec || "").trim(),
            deliverable: String(item?.deliverable || "").trim(),
            status: String(item?.status || "running").trim() || "running",
            startedAt: String(item?.startedAt || "").trim(),
            endedAt: String(item?.endedAt || "").trim(),
            error: String(item?.error || "").trim(),
            result: item?.result ?? null,
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
    task: String(taskItem?.task || "").trim(),
    sharedTaskSpec: String(taskItem?.sharedTaskSpec || "").trim(),
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
          task: String(request?.task || "").trim(),
          sharedTaskSpec: String(request?.sharedTaskSpec || "").trim(),
          status: "running",
          startedAt: "",
          endedAt: "",
          error: "",
          result: null,
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
    task: z.string().describe("子任务内容"),
    sharedTaskSpec: z.string().optional().describe("共享任务说明"),
  });

  const delegateTaskAsync = new DynamicStructuredTool({
    name: "delegate_task_async",
    description:
      "多agent协助：异步并发执行多个子任务。传入父sessionid和tasks数组，每个task中包含task、sharedTaskSpec。汇总结果并返回。",
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
          const taskText = request.task;
          const childContainer = createChildAsyncResultContainer({
            parentSessionId: normalizedParentSessionId,
            parentDialogProcessId: normalizedParentDialogProcessId,
            request,
          });
          if (!taskText) {
            patchContainerTaskAndStatus({
              container: childContainer,
              sessionId: generatedSessionId,
              patch: {
                status: "failed",
                error: "task required",
                endedAt: nowIso(),
              },
            });
            return {
              ok: false,
              index,
              error: "task required",
              parentAsyncResultContainer: childContainer || null,
              request: {
                ...request,
              },
            };
          }
          try {
            const result = botManager.runAsyncSession({
              userId,
              parentSessionId: normalizedParentSessionId,
              sessionId: generatedSessionId,
              task: taskText,
              sharedTaskSpec: String(taskItem?.sharedTaskSpec || "").trim(),
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
            return {
              ok: false,
              index,
              error: error?.message || String(error),
              parentAsyncResultContainer: childContainer || null,
              request,
            };
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
    }),
    func: async ({ timeoutMs }) => {
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
              const normalizedSessionId = String(
                taskItem?.sessionId || "",
              ).trim();
              const taskText = String(taskItem?.task || "").trim();
              if (!normalizedSessionId || !taskText) {
                return {
                  ok: false,
                  index,
                  status: "invalid_request",
                  error: "sessionId/task required",
                  request: taskItem,
                };
              }
              try {
                const result = await botManager.waitAsyncSession({
                  userId,
                  parentSessionId: normalizedParentSessionId,
                  sessionId: normalizedSessionId,
                  timeoutMs: resolvedTimeoutMs,
                });
                return {
                  ...result,
                  result: summarizeAsyncTaskResult(result?.result),
                  index,
                  request: {
                    sessionId: normalizedSessionId,
                    task: taskText,
                    sharedTaskSpec: String(
                      taskItem?.sharedTaskSpec || "",
                    ).trim(),
                  },
                };
              } catch (error) {
                if (isFatalError(error)) throw error;
                return {
                  ok: false,
                  index,
                  status: "failed",
                  error: error?.message || String(error),
                  request: {
                    sessionId: normalizedSessionId,
                    task: taskText,
                    sharedTaskSpec: String(
                      taskItem?.sharedTaskSpec || "",
                    ).trim(),
                  },
                };
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
          return {
            id: containerId,
            parentSessionId: normalizedParentSessionId,
            ok: status !== "failed",
            status,
            tasks: taskResults,
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
      const hasFailedTask = containerResults.some(
        (item) => String(item?.status || "") === "failed",
      );
      if (hasFailedTask) {
        return toToolJsonResult(
          "wait_async_task_result",
          {
            ok: false,
            status: "failed",
            child_async_result_containers: cloneData(containers),
            container_statuses: containerStatuses,
            task_stats: taskStats,
          },
          true,
        );
      }
      const hasStoppedTask = containerResults.some(
        (item) => String(item?.status || "") === "stopped",
      );
      if (hasStoppedTask) {
        return toToolJsonResult(
          "wait_async_task_result",
          {
            ok: true,
            status: "stopped",
            child_async_result_containers: cloneData(containers),
            container_statuses: containerStatuses,
            task_stats: taskStats,
          },
          true,
        );
      }
      const allCompleted = containerResults.every(
        (item) => String(item?.status || "") === "completed",
      );
      if (!allCompleted) {
        return toToolJsonResult(
          "wait_async_task_result",
          {
            ok: true,
            status: "running",
            child_async_result_containers: cloneData(containers),
            container_statuses: containerStatuses,
            task_stats: taskStats,
          },
          true,
        );
      }
      return toToolJsonResult(
        "wait_async_task_result",
        {
          ok: true,
          status: "completed",
          child_async_result_containers: cloneData(containers),
          container_statuses: containerStatuses,
          task_stats: taskStats,
        },
        true,
      );
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
            '{ "tasks":[{ "taskName":"任务a", "taskContent":"任务目标、内容", "sharedTaskSpec":"共享知识或数据","subTasks":[] }] }',
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
