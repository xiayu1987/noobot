/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { readFile, stat } from "node:fs/promises";
import { filePath as path } from "@noobot/path-resolver";
import { DynamicStructuredTool } from "@langchain/core/tools";
import { z } from "zod";
import { MODEL_CONTEXT_SEQUENCE_POLICY, MODEL_OPERATION_KIND } from "@noobot/model-protocol";
import { LENGTH_THRESHOLDS } from "@noobot/shared/length-thresholds";
import { EXTENSION_TO_MIME, DEFAULT_MIME_TYPE } from "../../shared/constants/index.js";
import { getRuntimeFromAgentContext } from "../../context/agent-context-accessor.js";
import { resolveCanonicalUserSourceAttachment } from "../../artifacts/index.js";
import { getEnabledProviders, resolveModelSpecByName } from "../../models/index.js";
import { assertAndResolveUserWorkspaceFilePath } from "../core/check-tool-input.js";
import { toToolJsonResult } from "../core/tool-json-result.js";
import { tTool } from "../core/tool-i18n.js";
import { recoverableToolError } from "../../shared/errors/index.js";
import { ERROR_CODE } from "../../shared/errors/constants.js";
import {
  backwriteFirstAttachment,
  normalizePersistedAttachments,
  persistDoc2DataTextAttachment,
} from "../data-processing/doc2data/artifacts.js";
import {
  ARTIFACT_GENERATION_SOURCE,
  TOOL_DATA_MODE,
  TOOL_NAME,
  TOOL_RESULT_STATUS,
} from "../constants/index.js";

const MAX_RESPONSES_FILE_INPUT_BYTES = LENGTH_THRESHOLDS.dataProcessing.responsesFileInputBytes;

function resolveMimeType(filePath = "", sourceAttachment = null) {
  return (
    String(sourceAttachment?.mimeType || "").trim() ||
    EXTENSION_TO_MIME[path.extname(String(filePath || "")).toLowerCase()] ||
    DEFAULT_MIME_TYPE
  );
}

function supportsMultimodalParsing(modelSpec = null) {
  return modelSpec?.multimodal_parsing?.enabled === true;
}

function resolveConfiguredParseModel({ modelName = "", runtime = {} } = {}) {
  const globalConfig = runtime?.globalConfig || {};
  const userConfig = runtime?.userConfig || {};
  const requested = String(modelName || "").trim();
  if (requested) {
    const explicitModel = resolveModelSpecByName({
      modelName: requested,
      globalConfig,
      userConfig,
      fallbackToDefault: false,
    });
    return supportsMultimodalParsing(explicitModel) ? explicitModel : null;
  }
  const runtimeModel = String(runtime?.runtimeModel || "").trim();
  const currentModel = resolveModelSpecByName({
    modelName: runtimeModel,
    globalConfig: runtime?.globalConfig || {},
    userConfig: runtime?.userConfig || {},
    fallbackToDefault: false,
  });
  if (supportsMultimodalParsing(currentModel)) return currentModel;
  for (const [alias] of Object.entries(getEnabledProviders(globalConfig, userConfig))) {
    const candidate = resolveModelSpecByName({
      modelName: alias,
      globalConfig,
      userConfig,
      fallbackToDefault: false,
    });
    if (supportsMultimodalParsing(candidate)) return candidate;
  }
  return null;
}

export function createMultimodalParseTool({ agentContext }) {
  const runtime = getRuntimeFromAgentContext(agentContext);
  if (!String(runtime?.basePath || "").trim()) return [];
  const tool = new DynamicStructuredTool({
    name: TOOL_NAME.MULTIMODAL_PARSE,
    description: tTool(runtime, "tools.multimodalParse.description"),
    schema: z.object({
      file_paths: z
        .array(z.string())
        .min(1)
        .describe(tTool(runtime, "tools.multimodalParse.fieldFilePaths")),
      prompt: z.string().optional().describe(tTool(runtime, "tools.multimodalParse.fieldPrompt")),
      model_name: z
        .string()
        .optional()
        .describe(tTool(runtime, "tools.multimodalParse.fieldModelName")),
    }),
    func: async (
      { file_paths, prompt = "", model_name = "" },
      _runManager,
      toolConfig = {},
    ) => {
      const filePaths = Array.isArray(file_paths)
        ? file_paths.map((value) => String(value || "").trim()).filter(Boolean)
        : [];
      if (!filePaths.length) {
        throw recoverableToolError(tTool(runtime, "tools.multimodalParse.filePathsRequired"), {
          code: ERROR_CODE.RECOVERABLE_INPUT_MISSING,
        });
      }
      const inputFiles = await Promise.all(filePaths.map((filePath) =>
        assertAndResolveUserWorkspaceFilePath({
          filePath,
          agentContext,
          fieldName: "file_paths",
          mustExist: true,
        })));
      const [sourceAttachmentMetas, inputFileStats] = await Promise.all([
        Promise.all(inputFiles.map((filePath) => resolveCanonicalUserSourceAttachment({
          filePath,
          agentContext,
        }))),
        Promise.all(inputFiles.map((filePath) => stat(filePath))),
      ]);
      const totalFileSizeBytes = inputFileStats.reduce(
        (total, inputFileStat) => total + Number(inputFileStat.size || 0),
        0,
      );
      if (totalFileSizeBytes >= MAX_RESPONSES_FILE_INPUT_BYTES) {
        throw recoverableToolError(tTool(runtime, "tools.multimodalParse.fileTooLarge", {
          maxSizeMB: MAX_RESPONSES_FILE_INPUT_BYTES / (1000 * 1000),
        }), {
          code: ERROR_CODE.RECOVERABLE_ATTACHMENT_FILE_SIZE_LIMIT_EXCEEDED,
          details: {
            fileCount: inputFiles.length,
            totalFileSizeBytes,
            maxFileSizeBytesExclusive: MAX_RESPONSES_FILE_INPUT_BYTES,
          },
        });
      }
      const modelSpec = resolveConfiguredParseModel({ modelName: model_name, runtime });
      if (!modelSpec) {
        throw recoverableToolError(tTool(runtime, "tools.multimodalParse.modelNotFound"), {
          code: ERROR_CODE.FATAL_MODEL_NOT_FOUND,
        });
      }
      const modelPort = runtime?.modelPort;
      if (!modelPort || typeof modelPort.invoke !== "function") {
        throw new TypeError("multimodal_parse requires runtime.modelPort");
      }
      const inputAttachments = await Promise.all(inputFiles.map(async (inputFile, index) => {
        const mimeType = resolveMimeType(inputFile, sourceAttachmentMetas[index]);
        return {
          mimeType,
          data: `data:${mimeType};base64,${(await readFile(inputFile)).toString("base64")}`,
          fileName: path.basename(inputFile),
        };
      }));
      const parsePrompt =
        String(prompt || "").trim() || tTool(runtime, "tools.multimodalParse.defaultPrompt");
      const response = await modelPort.invoke({
        model: modelSpec,
        messages: [],
        operation: {
          kind: MODEL_OPERATION_KIND.MULTIMODAL_PARSE,
          input: {
            prompt: parsePrompt,
            attachments: inputAttachments,
          },
        },
        options: { streaming: false, signal: runtime?.abortSignal || undefined },
        invocation: {
          flow: "tool.multimodal_parse",
          purpose: "multimodal_extraction",
          domain: "data_processing",
          contextSequencePolicy: MODEL_CONTEXT_SEQUENCE_POLICY.INDEPENDENT_REQUEST,
        },
      });
      const text = String(response?.output?.text || response?.result?.rawText || "");
      const persistedOutput = await persistDoc2DataTextAttachment({
        runtime,
        agentContext,
        inputFile: inputFiles[0],
        text,
        mode: TOOL_DATA_MODE.IMAGE_MODEL,
        identity: toolConfig?.configurable?.transferIdentity,
        toolName: TOOL_NAME.MULTIMODAL_PARSE,
        generationSource: ARTIFACT_GENERATION_SOURCE.MULTIMODAL_PARSE_TOOL,
        artifactLabel: "multimodal-parse",
      });
      const attachments = normalizePersistedAttachments(persistedOutput);
      const updatedSourceAttachments = (await Promise.all(sourceAttachmentMetas.map(
        async (sourceAttachmentMeta) => sourceAttachmentMeta
          ? backwriteFirstAttachment({
          runtime,
          sourceAttachmentMeta,
          attachments,
          toolName: TOOL_NAME.MULTIMODAL_PARSE,
          })
          : null,
      ))).filter(Boolean);
      return toToolJsonResult(
        TOOL_NAME.MULTIMODAL_PARSE,
        {
          ok: true,
          status: TOOL_RESULT_STATUS.COMPLETED,
          mode: "openai_responses_api",
          inputs: inputFiles,
          ...persistedOutput.resultFields,
          model: { alias: modelSpec.alias || "", name: modelSpec.model || "" },
          summary: {
            parsed_from_attachment_ids: sourceAttachmentMetas
              .map((attachment) => String(attachment?.attachmentId || "").trim())
              .filter(Boolean),
            source_attachment_backwritten_count: updatedSourceAttachments.length,
            input_file_count: inputFiles.length,
            total_file_size_bytes: totalFileSizeBytes,
            saved_attachment_count: attachments.length,
            text_length: text.length,
          },
        },
        true,
      );
    },
  });
  return [tool];
}
