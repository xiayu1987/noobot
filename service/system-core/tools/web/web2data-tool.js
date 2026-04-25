/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { DynamicStructuredTool } from "@langchain/core/tools";
import { z } from "zod";
import { mergeConfig } from "../../config/index.js";
import { runWebToDataPipeline } from "./web-to-data-pipeline.js";
import { toToolJsonResult } from "../tool-json-result.js";

function getRuntime(agentContext) {
  return agentContext?.runtime || {};
}

function normalizeProcessMode(value = "") {
  const mode = String(value || "").trim().toLowerCase();
  if (mode === "multimodal") return "multimodal";
  if (
    mode === "browser_simulate" ||
    mode === "browser-simulate" ||
    mode === "browser"
  ) {
    return "browser_simulate";
  }
  return "direct";
}

export function createWeb2DataTool({ agentContext }) {
  const runtime = getRuntime(agentContext);
  const basePath = agentContext?.basePath || runtime.basePath || "";
  const effectiveConfig = mergeConfig(
    runtime?.globalConfig || {},
    runtime?.userConfig || {},
  );
  const processMode = normalizeProcessMode(
    effectiveConfig?.tools?.web_to_data?.switchWebMode,
  );
  if (!basePath) return [];

  const webToDataTool = new DynamicStructuredTool({
    name: "web_to_data",
    description:
      "根据提供url进行网页解析并提取内容。支持单 URL 或批量 URLs。",
    schema: z.object({
      input: z
        .string()
        .optional()
        .describe("URL 或工作区内 txt 列表文件路径（可包含多行 URL）"),
      urls: z.array(z.string()).optional().describe("批量 URL 列表"),
      prompt: z.string().optional().describe("默认提取网页核心事实并按条目输出"),
      useTrafilatura: z
        .boolean()
        .optional()
        .describe("仅 multimodal 模式生效：是否优先使用 Readability 提取正文，默认 true"),
    }),
    func: async ({ input = "", urls = [], prompt, useTrafilatura }) => {
      const payload = await runWebToDataPipeline({
        agentContext,
        input,
        urls,
        prompt,
        useTrafilatura: useTrafilatura !== false,
        processMode,
      });
      const text = String(payload?.text || "").trim();
      return toToolJsonResult(
        "web_to_data",
        {
          ok: payload?.ok === true,
          status: payload?.ok === true ? "completed" : "failed",
          mode: payload?.mode || processMode,
          message: String(payload?.message || ""),
          input: payload?.input || input || "",
          urls: Array.isArray(payload?.urls) ? payload.urls : [],
          successCount: Number(payload?.successCount || 0),
          resultCount: Number(payload?.resultCount || 0),
          imageCount: Number(payload?.imageCount || 0),
          batchCount: Number(payload?.batchCount || 0),
          text,
          model: payload?.model || {},
          summary: {
            text_length: text.length,
          },
        },
        true,
      );
    },
  });

  return [webToDataTool];
}

export { runWebToDataPipeline } from "./web-to-data-pipeline.js";
