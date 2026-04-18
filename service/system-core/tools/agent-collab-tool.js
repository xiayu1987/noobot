/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { DynamicStructuredTool } from "@langchain/core/tools";
import { HumanMessage, SystemMessage } from "@langchain/core/messages";
import { access, mkdir, readFile, writeFile } from "node:fs/promises";
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
    if (!name) throw new Error("fileName required");
    if (name.includes("/") || name.includes("\\")) {
      throw new Error("fileName must not contain path separators");
    }
    if (!/^[a-zA-Z0-9._-]+$/.test(name)) {
      throw new Error("invalid fileName");
    }
    return name;
  };

  const resolveSubAgentFile = async (fileName = "") => {
    if (!subAgentDir) throw new Error("runtime basePath missing");
    await mkdir(subAgentDir, { recursive: true });
    const name = normalizeFileName(fileName);
    return safeJoin(subAgentDir, name);
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
          return JSON.stringify({
            ok: false,
            error: `file already exists: ${String(fileName || "")}`,
          });
        } catch {}
        await writeFile(filePath, String(content || ""), "utf8");
        return JSON.stringify({
          ok: true,
          fileName: String(fileName || ""),
          path: filePath,
        });
      } catch (error) {
        return JSON.stringify({
          ok: false,
          error: error?.message || String(error),
        });
      }
    },
  });

  const readTaskDeliverableFile = new DynamicStructuredTool({
    name: "read_task_deliverable_file",
    description: "读取子任务交付物文件",
    schema: z.object({
      fileName: z.string().describe("交付物文件名（仅文件名，不可含路径分隔符）"),
    }),
    func: async ({ fileName }) => {
      try {
        const filePath = await resolveSubAgentFile(fileName);
        try {
          await access(filePath);
        } catch {
          return JSON.stringify({
            ok: false,
            error: `file not found: ${String(fileName || "")}`,
          });
        }
        return JSON.stringify({
          ok: true,
          fileName: String(fileName || ""),
          path: filePath,
          content: await readFile(filePath, "utf8"),
        });
      } catch (error) {
        return JSON.stringify({
          ok: false,
          error: error?.message || String(error),
        });
      }
    },
  });

  const delegateTaskAsync = new DynamicStructuredTool({
    name: "delegate_task_async",
    description:
      "多agent协助：异步执行子任务。传入父sessionid、任务、共享任务说明、规定最终交付物（文件名及说明）；可选传sessionId以继续之前子会话。",
    schema: z.object({
      parentSessionId: z.string().describe("父会话ID（UUID）"),
      sessionId: z.string().optional().describe("子会话ID（UUID，可选，传入则续用）"),
      task: z.string().describe("子任务内容"),
      sharedTaskSpec: z.string().optional().describe("共享任务说明"),
      deliverable: z.string().describe("最终交付物要求（文件名及说明）"),
    }),
    func: async ({
      parentSessionId,
      sessionId,
      task,
      sharedTaskSpec,
      deliverable,
    }) => {
      if (!botManager || !userId)
        return JSON.stringify({
          ok: false,
          error: "runtime missing bot manager/user id",
        });
      if (
        !String(parentSessionId || "").trim() ||
        !String(task || "").trim() ||
        !String(deliverable || "").trim()
      ) {
        return JSON.stringify({
          ok: false,
          error: "parentSessionId/task/deliverable required",
        });
      }
      const result = botManager.runAsyncSession({
        userId,
        parentSessionId: String(parentSessionId || "").trim(),
        sessionId: String(sessionId || "").trim(),
        task: String(task || "").trim(),
        sharedTaskSpec: String(sharedTaskSpec || "").trim(),
        deliverable: String(deliverable || "").trim(),
        eventListener: runtimeEventListener,
        sourceDialogProcessId: String(sourceDialogProcessId || ""),
        userInteractionBridge,
        runConfig,
      });
      return JSON.stringify(result, null, 2);
    },
  });

  const waitAsyncTaskResult = new DynamicStructuredTool({
    name: "wait_async_task_result",
    description:
      "等待异步子会话结果。传入父sessionid、sessionId、任务、最终交付物（文件名及说明），可选最大等待毫秒（可被用户配置覆盖默认值）。约束：父agent完成自身任务后才等待",
    schema: z.object({
      parentSessionId: z.string().describe("父会话ID（UUID）"),
      sessionId: z.string().describe("子会话ID（UUID）"),
      task: z.string().describe("子任务内容（用于结果关联）"),
      deliverable: z.string().describe("最终交付物要求（用于结果关联）"),
      timeoutMs: z.number().int().positive().optional().describe("最大等待毫秒数"),
    }),
    func: async ({
      parentSessionId,
      sessionId,
      task,
      deliverable,
      timeoutMs,
    }) => {
      if (!botManager || !userId)
        return JSON.stringify({
          ok: false,
          error: "runtime missing bot manager/user id",
        });
      if (
        !String(parentSessionId || "").trim() ||
        !String(sessionId || "").trim() ||
        !String(task || "").trim() ||
        !String(deliverable || "").trim()
      ) {
        return JSON.stringify({
          ok: false,
          error: "parentSessionId/sessionId/task/deliverable required",
        });
      }
      const result = await botManager.waitAsyncSession({
        userId,
        parentSessionId: String(parentSessionId || "").trim(),
        sessionId: String(sessionId || ""),
        timeoutMs: Number(timeoutMs || defaultWaitMs),
      });
      return JSON.stringify(
        {
          ...result,
          request: {
            task: String(task || ""),
            deliverable: String(deliverable || ""),
          },
        },
        null,
        2,
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
        return JSON.stringify({ ok: false, error: "task required" });

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

      return JSON.stringify(
        {
          ok: true,
          task: taskText,
          model: {
            alias: modelSpec?.alias || "",
            name: modelSpec?.model || "",
          },
          ...(parsedPlan ? { plan: parsedPlan } : { planText: content }),
        },
        null,
        2,
      );
    },
  });

  return [
    writeTaskDeliverableFile,
    readTaskDeliverableFile,
    delegateTaskAsync,
    waitAsyncTaskResult,
    planExecutionFlow,
  ];
}
