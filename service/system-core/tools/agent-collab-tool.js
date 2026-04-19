/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { DynamicStructuredTool } from "@langchain/core/tools";
import { HumanMessage, SystemMessage } from "@langchain/core/messages";
import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { z } from "zod";
import { mergeConfig } from "../config/index.js";
import {
  createChatModel,
  createChatModelByName,
  resolveDefaultModelSpec,
  resolveModelSpecByName,
} from "../model/index.js";
import { safeJoin } from "../utils/fs-safe.js";
import {
  fatalSystemError,
  isFatalError,
  recoverableToolError,
} from "../error/index.js";
import { assertValidParentSessionId } from "./check-tool-input.js";
import { toToolJsonResult } from "./tool-json-result.js";

function getRuntime(agentContext) {
  return agentContext?.runtime || {};
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
  const defaultWaitMs = Number(effectiveConfig?.async?.waitTimeoutMs || 120000);
  const basePath = agentContext?.basePath || runtime.basePath || "";
  const subAgentDir = basePath ? path.join(basePath, "runtime/subagent") : "";

  const normalizeFileName = (fileName = "") => {
    const name = String(fileName || "").trim();
    if (!name) throw recoverableToolError("fileName required");
    if (name.includes("/") || name.includes("\\")) {
      throw recoverableToolError("fileName must not contain path separators");
    }
    if (!/^[a-zA-Z0-9._-]+$/.test(name)) {
      throw recoverableToolError("invalid fileName");
    }
    return name;
  };

  const resolveSubAgentFile = async (fileName = "") => {
    if (!subAgentDir) {
      throw fatalSystemError("runtime basePath missing", {
        code: "FATAL_RUNTIME_BASEPATH_MISSING",
      });
    }
    await mkdir(subAgentDir, { recursive: true });
    const name = normalizeFileName(fileName);
    return safeJoin(subAgentDir, name);
  };

  const delegateTaskItemSchema = z.object({
    task: z.string().describe("子任务内容"),
    sharedTaskSpec: z.string().optional().describe("共享任务说明"),
    deliverable: z.string().describe("最终交付物要求（文件名及说明）"),
  });

  const waitTaskItemSchema = z.object({
    sessionId: z.string().describe("子会话ID（UUID）"),
    task: z.string().describe("子任务内容（用于结果关联）"),
    sharedTaskSpec: z.string().optional().describe("共享任务说明"),
    deliverable: z.string().describe("最终交付物要求（用于结果关联）"),
  });

  const collectFileNamesFromValue = (value, outputSet) => {
    if (!value) return;
    if (typeof value === "string") {
      const normalized = value.trim();
      if (normalized) {
        try {
          outputSet.add(normalizeFileName(normalized));
        } catch {
          // ignore non-filename strings
        }
      }
      return;
    }
    if (Array.isArray(value)) {
      for (const item of value) collectFileNamesFromValue(item, outputSet);
      return;
    }
    if (typeof value === "object") {
      for (const [key, nested] of Object.entries(value)) {
        const normalizedKey = String(key || "").toLowerCase();
        if (
          normalizedKey === "filename" ||
          normalizedKey === "filenames" ||
          normalizedKey === "files"
        ) {
          collectFileNamesFromValue(nested, outputSet);
        }
      }
    }
  };

  const parseDeliverableFileNames = (deliverable = "") => {
    const out = new Set();
    const text = String(deliverable || "").trim();
    if (!text) return [];

    try {
      const parsed = JSON.parse(text);
      collectFileNamesFromValue(parsed, out);
    } catch {
      // not a json payload
    }

    const patternMatches =
      text.match(/[A-Za-z0-9][A-Za-z0-9._-]*\.[A-Za-z0-9_-]+/g) || [];
    for (const fileName of patternMatches) {
      try {
        out.add(normalizeFileName(fileName));
      } catch {
        // ignore invalid match
      }
    }
    return Array.from(out);
  };

  const readDeliverablesByTask = async (taskItem = {}) => {
    const fileNames = parseDeliverableFileNames(taskItem?.deliverable || "");
    const deliverableFiles = [];
    const missingDeliverables = [];
    for (const fileName of fileNames) {
      try {
        const filePath = await resolveSubAgentFile(fileName);
        await access(filePath);
        deliverableFiles.push({
          fileName,
          path: filePath,
          content: await readFile(filePath, "utf8"),
        });
      } catch {
        missingDeliverables.push(fileName);
      }
    }
    return {
      deliverableFiles,
      missingDeliverables,
    };
  };

  const writeTaskDeliverableFile = new DynamicStructuredTool({
    name: "write_task_deliverable_file",
    description: "子任务写入任务交付物文件。文件名重复会报错。",
    schema: z.object({
      fileName: z.string().describe("交付物文件名（仅文件名，不可含路径分隔符）"),
      content: z.string().describe("交付物文件内容"),
    }),
    func: async ({ fileName, content }) => {
      try {
        const filePath = await resolveSubAgentFile(fileName);
        try {
          await access(filePath);
          return toToolJsonResult("write_task_deliverable_file", {
            ok: false,
            error: `file already exists: ${String(fileName || "")}`,
          });
        } catch {}
        await writeFile(filePath, String(content || ""), "utf8");
        return toToolJsonResult("write_task_deliverable_file", {
          ok: true,
          fileName: String(fileName || ""),
          path: filePath,
        });
      } catch (error) {
        if (isFatalError(error)) throw error;
        return toToolJsonResult("write_task_deliverable_file", {
          ok: false,
          error: error?.message || String(error),
        });
      }
    },
  });

  const delegateTaskAsync = new DynamicStructuredTool({
    name: "delegate_task_async",
    description:
      "多agent协助：异步并发执行多个子任务。传入父sessionid和tasks数组，每个task中包含task、sharedTaskSpec、deliverable。sessionId 由系统自动生成并在结果中返回。",
    schema: z.object({
      parentSessionId: z.string().describe("父会话ID（UUID）"),
      tasks: z
        .array(delegateTaskItemSchema)
        .min(1)
        .describe("并发子任务列表"),
    }),
    func: async ({ parentSessionId, tasks }) => {
      if (!botManager || !userId)
        return toToolJsonResult("delegate_task_async", {
          ok: false,
          error: "runtime missing bot manager/user id",
        });
      const normalizedParentSessionId = await assertValidParentSessionId({
        parentSessionId,
        agentContext,
      });
      if (!Array.isArray(tasks) || !tasks.length) {
        throw recoverableToolError("tasks required", {
          code: "RECOVERABLE_INPUT_MISSING",
          details: { field: "tasks" },
        });
      }
      const resultList = await Promise.all(
        tasks.map(async (taskItem = {}, index) => {
          const taskText = String(taskItem?.task || "").trim();
          const deliverableText = String(taskItem?.deliverable || "").trim();
          const generatedSessionId = randomUUID();
          if (!taskText || !deliverableText) {
            return {
              ok: false,
              index,
              error: "task/deliverable required",
              request: {
                sessionId: generatedSessionId,
                ...taskItem,
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
              deliverable: deliverableText,
              eventListener: runtimeEventListener,
              sourceDialogProcessId: String(sourceDialogProcessId || ""),
              userInteractionBridge,
              runConfig,
              abortSignal,
            });
            return {
              ok: true,
              index,
              ...result,
              request: {
                sessionId: generatedSessionId,
                task: taskText,
                sharedTaskSpec: String(taskItem?.sharedTaskSpec || "").trim(),
                deliverable: deliverableText,
              },
            };
          } catch (error) {
            if (isFatalError(error)) throw error;
            return {
              ok: false,
              index,
              error: error?.message || String(error),
              request: {
                sessionId: generatedSessionId,
                task: taskText,
                sharedTaskSpec: String(taskItem?.sharedTaskSpec || "").trim(),
                deliverable: deliverableText,
              },
            };
          }
        }),
      );
      const allOk = resultList.every((item) => item?.ok);
      return toToolJsonResult(
        "delegate_task_async",
        {
          ok: allOk,
          status: allOk ? "running" : "partial_failed",
          parentSessionId: normalizedParentSessionId,
          tasks: resultList,
        },
        true,
      );
    },
  });

  const waitAsyncTaskResult = new DynamicStructuredTool({
    name: "wait_async_task_result",
    description:
      "并发等待多个异步子会话结果。传入父sessionid和tasks数组（每项含sessionId/task/sharedTaskSpec/deliverable），可选timeoutMs。全部完成后会检查并读取交付物文件。",
    schema: z.object({
      parentSessionId: z.string().describe("父会话ID（UUID）"),
      tasks: z
        .array(waitTaskItemSchema)
        .min(1)
        .describe("待检查的并发子任务列表"),
      timeoutMs: z.number().int().positive().optional().describe("最大等待毫秒数"),
    }),
    func: async ({ parentSessionId, tasks, timeoutMs }) => {
      if (!botManager || !userId)
        return toToolJsonResult("wait_async_task_result", {
          ok: false,
          error: "runtime missing bot manager/user id",
        });
      const normalizedParentSessionId = await assertValidParentSessionId({
        parentSessionId,
        agentContext,
      });
      if (!Array.isArray(tasks) || !tasks.length) {
        throw recoverableToolError("tasks required", {
          code: "RECOVERABLE_INPUT_MISSING",
          details: { field: "tasks" },
        });
      }
      const resultList = await Promise.all(
        tasks.map(async (taskItem = {}, index) => {
          const normalizedSessionId = String(taskItem?.sessionId || "").trim();
          const taskText = String(taskItem?.task || "").trim();
          const deliverableText = String(taskItem?.deliverable || "").trim();
          if (!normalizedSessionId || !taskText || !deliverableText) {
            return {
              ok: false,
              index,
              status: "invalid_request",
              error: "sessionId/task/deliverable required",
              request: taskItem,
            };
          }
          try {
            const result = await botManager.waitAsyncSession({
              userId,
              parentSessionId: normalizedParentSessionId,
              sessionId: normalizedSessionId,
              timeoutMs: Number(timeoutMs || defaultWaitMs),
            });
            return {
              ...result,
              index,
              request: {
                sessionId: normalizedSessionId,
                task: taskText,
                sharedTaskSpec: String(taskItem?.sharedTaskSpec || "").trim(),
                deliverable: deliverableText,
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
                sharedTaskSpec: String(taskItem?.sharedTaskSpec || "").trim(),
                deliverable: deliverableText,
              },
            };
          }
        }),
      );
      const hasFailedTask = resultList.some(
        (item) => String(item?.status || "") === "failed" || item?.ok === false,
      );
      if (hasFailedTask) {
        return toToolJsonResult(
          "wait_async_task_result",
          {
            ok: false,
            status: "failed",
            parentSessionId: normalizedParentSessionId,
            tasks: resultList,
          },
          true,
        );
      }
      const hasStoppedTask = resultList.some(
        (item) => String(item?.status || "") === "stopped",
      );
      if (hasStoppedTask) {
        return toToolJsonResult(
          "wait_async_task_result",
          {
            ok: true,
            status: "stopped",
            parentSessionId: normalizedParentSessionId,
            tasks: resultList,
          },
          true,
        );
      }
      const allCompleted = resultList.every(
        (item) => String(item?.status || "") === "completed",
      );
      if (!allCompleted) {
        return toToolJsonResult(
          "wait_async_task_result",
          {
            ok: true,
            status: "running",
            parentSessionId: normalizedParentSessionId,
            tasks: resultList,
          },
          true,
        );
      }

      const deliverableChecks = await Promise.all(
        resultList.map(async (resultItem = {}) => {
          const deliverables = await readDeliverablesByTask(resultItem.request || {});
          return {
            ...resultItem,
            ...deliverables,
          };
        }),
      );
      const allDeliverablesReady = deliverableChecks.every(
        (item) =>
          Array.isArray(item?.missingDeliverables) &&
          !item.missingDeliverables.length,
      );
      if (!allDeliverablesReady) {
        return toToolJsonResult(
          "wait_async_task_result",
          {
            ok: true,
            status: "waiting_deliverables",
            parentSessionId: normalizedParentSessionId,
            tasks: deliverableChecks,
          },
          true,
        );
      }
      return toToolJsonResult(
        "wait_async_task_result",
        {
          ok: true,
          status: "completed",
          parentSessionId: normalizedParentSessionId,
          tasks: deliverableChecks,
        },
        true,
      );
    },
  });

  const planExecutionFlow = new DynamicStructuredTool({
    name: "plan_execution_flow",
    description:
      "流程规划工具：输入任务文本，调用大模型将任务拆分为可执行流程并返回。",
    schema: z.object({
      task: z.string().describe("需要拆分流程的任务文本"),
    }),
    func: async ({ task }) => {
      const taskText = String(task || "").trim();
      if (!taskText)
        return toToolJsonResult("plan_execution_flow", {
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
            "流程规划，请把用户任务拆分为可执行流程。",
            "输出必须是 JSON，不要使用 markdown 代码块。",
            "JSON 格式：",
            '{ "summary": "任务概述", "flow": [{ "step": 1, "title": "步骤标题", "goal": "目标", "actions": ["具体动作"], "deliverable": "产出", "dependsOn": [1] }] }',
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
        "plan_execution_flow",
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
    writeTaskDeliverableFile,
    delegateTaskAsync,
    waitAsyncTaskResult,
    planExecutionFlow,
  ];
}
