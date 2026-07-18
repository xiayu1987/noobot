/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { filePath as path } from "../../utils/path-resolver.js";
import { DynamicStructuredTool } from "@langchain/core/tools";
import { z } from "zod";
import { mergeConfig } from "../../config/index.js";
import { recoverableToolError } from "../../error/index.js";
import { getRuntimeFromAgentContext } from "../../context/agent-context-accessor.js";
import { toToolJsonResult } from "../core/tool-json-result.js";
import { tTool } from "../core/tool-i18n.js";
import { getTransferAttachmentMetas, materializeTextForToolResult, TRANSFER_SOURCE } from "../../semantic-transfer/index.js";
import { ERROR_CODE } from "../../error/constants.js";
import { ARTIFACT_GENERATION_SOURCE, TOOL_ATTACHMENT_SOURCE, TOOL_NAME, TOOL_RESULT_STATUS } from "../constants/index.js";
import { runWebToDataPipeline } from "./web2data/pipeline.js";
import { isUrl, normalizeProcessMode, sanitizeArtifactBaseName, tWeb } from "./web2data/utils.js";

export { runWebToDataPipeline } from "./web2data/pipeline.js";
export function createWeb2DataTool({ agentContext }) {
  const runtime = getRuntimeFromAgentContext(agentContext);
  const basePath =
    agentContext?.environment?.workspace?.basePath || runtime.basePath || "";
  const effectiveConfig = mergeConfig(
    runtime?.globalConfig || {},
    runtime?.userConfig || {},
  );
  const processMode = normalizeProcessMode(
    effectiveConfig?.tools?.[TOOL_NAME.WEB_TO_DATA]?.switchWebMode,
  );
  if (!basePath) return [];

  const webToDataTool = new DynamicStructuredTool({
    name: TOOL_NAME.WEB_TO_DATA,
    description: tTool(runtime, "tools.web2data.description"),
    schema: z.object({
      input: z
        .string()
        .optional()
        .describe(tTool(runtime, "tools.web2data.fieldInput")),
      urls: z.array(z.string()).optional().describe(tTool(runtime, "tools.web2data.fieldUrls")),
      prompt: z.string().optional().describe(tTool(runtime, "tools.web2data.fieldPrompt")),
      useTrafilatura: z
        .boolean()
        .optional()
        .describe(tTool(runtime, "tools.web2data.fieldUseTrafilatura")),
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
      if (payload?.ok !== true) {
        throw recoverableToolError(
          String(payload?.message || tWeb(runtime, "fetchFailedNoResult")),
          {
            code: ERROR_CODE.RECOVERABLE_WEB_TO_DATA_FAILED,
            details: {
              mode: payload?.mode || processMode,
              input: payload?.input || input || "",
              urls: Array.isArray(payload?.urls) ? payload.urls : [],
              successCount: Number(payload?.successCount || 0),
              resultCount: Number(payload?.resultCount || 0),
              imageCount: Number(payload?.imageCount || 0),
              batchCount: Number(payload?.batchCount || 0),
              model: payload?.model || {},
            },
          },
        );
      }
      const text = String(payload?.text || "").trim();
      const inputName = sanitizeArtifactBaseName(
        isUrl(payload?.input || input || "")
          ? new URL(String(payload?.input || input || "")).hostname
          : path.basename(String(payload?.input || input || "").trim() || "web"),
      );
      const modeName = sanitizeArtifactBaseName(payload?.mode || processMode || "result", "result");
      const materialized = await materializeTextForToolResult({
        runtime,
        agentContext,
        text,
        name: `${inputName}.web2data.${modeName}.md`,
        mimeType: "text/markdown",
        attachmentSource: TOOL_ATTACHMENT_SOURCE.MODEL,
        generationSource: ARTIFACT_GENERATION_SOURCE.WEB_TO_DATA_TOOL,
        source: TRANSFER_SOURCE.TOOL,
        reason: ARTIFACT_GENERATION_SOURCE.WEB_TO_DATA_TOOL,
        alwaysPersist: true,
        producer: { type: "tool", name: TOOL_NAME.WEB_TO_DATA },
        meta: { mode: payload?.mode || processMode, input: payload?.input || input || "" },
      });
      const savedAttachmentMetas = getTransferAttachmentMetas(materialized.transferEnvelopes);
      return toToolJsonResult(
        TOOL_NAME.WEB_TO_DATA,
        {
          ok: true,
          status: TOOL_RESULT_STATUS.COMPLETED,
          mode: payload?.mode || processMode,
          message: "内容已通过 semantic-transfer 保存到附件；未超过限制时同时直接返回 text，超过限制时返回预览。",
          input: payload?.input || input || "",
          urls: Array.isArray(payload?.urls) ? payload.urls : [],
          successCount: Number(payload?.successCount || 0),
          resultCount: Number(payload?.resultCount || 0),
          imageCount: Number(payload?.imageCount || 0),
          batchCount: Number(payload?.batchCount || 0),
          ...materialized.resultFields,
          model: payload?.model || {},
          summary: {
            text_length: text.length,
            saved_attachment_count: savedAttachmentMetas.length,
          },
        },
        true,
      );
    },
  });

  return [webToDataTool];
}
