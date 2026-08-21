/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { readFile, stat } from "node:fs/promises";
import { PATH_CAPABILITIES, TOOL_PATH_CONTRACTS, filePath as path } from "@noobot/path-resolver";
import { DynamicStructuredTool } from "@langchain/core/tools";
import { z } from "zod";
import {
  MULTIMODAL_CONFIG_OPERATION,
  mergeConfig,
  resolveMultimodalDefaultModelSelection,
} from "../../config/index.js";
import {
  MODEL_CONTEXT_SEQUENCE_POLICY,
  MODEL_INPUT_PROCESSING_KIND,
  MODEL_OPERATION_KIND,
  classifyModelInputProcessing,
  supportsModelMultimodalParsing,
} from "@noobot/model-protocol";
import { LENGTH_THRESHOLDS } from "@noobot/shared/length-thresholds";
import { projectAttachmentIdentity } from "@noobot/attachment-protocol";
import { EXTENSION_TO_MIME, DEFAULT_MIME_TYPE } from "../../shared/constants/index.js";
import { getRuntimeFromAgentContext } from "../../context/agent-context-accessor.js";
import { resolveModelSpecOrConfiguredDefault } from "../../models/index.js";
import { createFileInputSchema, isUserAttachment, resolveFileInput } from "../core/file-input.js";
import { registerTransferAttachmentResources } from "../core/resource-broker.js";
import { toToolJsonResult } from "../core/tool-json-result.js";
import { tTool } from "../core/tool-i18n.js";
import { recoverableToolError } from "../../shared/errors/index.js";
import { ERROR_CODE } from "../../shared/errors/constants.js";
import {
  backwriteParsedAttachment,
  normalizePersistedAttachments,
  persistParsedTextAttachment,
} from "../core/parsed-artifact-persistence.js";
import { TOOL_DATA_MODE, TOOL_NAME, TOOL_RESULT_STATUS } from "../constants/index.js";

const MAX_RESPONSES_FILE_INPUT_BYTES = LENGTH_THRESHOLDS.dataProcessing.responsesFileInputBytes;

function resolveMimeType(filePath = "", sourceAttachment = null) {
  return (
    String(sourceAttachment?.mimeType || "").trim() ||
    EXTENSION_TO_MIME[path.extname(String(filePath || "")).toLowerCase()] ||
    DEFAULT_MIME_TYPE
  );
}

function resolveConfiguredParseModel({
  modelName = "",
  requiredModalities = [],
  runtime = {},
} = {}) {
  const globalConfig = runtime?.globalConfig || {};
  const userConfig = runtime?.userConfig || {};
  const explicitModel = String(modelName || "").trim();
  const selection = explicitModel
    ? null
    : resolveMultimodalDefaultModelSelection(mergeConfig(globalConfig, userConfig), {
        operation: MULTIMODAL_CONFIG_OPERATION.PARSING,
        modalities: requiredModalities,
      });
  const requestedModel = explicitModel || selection?.alias || "";
  if (!requestedModel) return { modelSpec: null, selection };
  const modelSpec = resolveModelSpecOrConfiguredDefault({
    modelName: requestedModel,
    globalConfig,
    userConfig,
  });
  return {
    modelSpec: supportsModelMultimodalParsing(modelSpec, requiredModalities) ? modelSpec : null,
    selection,
  };
}

export function createMultimodalParseTool({ agentContext }) {
  const runtime = getRuntimeFromAgentContext(agentContext);
  if (!String(runtime?.basePath || "").trim()) return [];
  const tool = new DynamicStructuredTool({
    name: TOOL_NAME.MULTIMODAL_PARSE,
    metadata: { pathContract: TOOL_PATH_CONTRACTS.multimodalInput },
    description: tTool(runtime, "tools.multimodalParse.description"),
    schema: z.object({
      inputs: z
        .array(
          createFileInputSchema({
            filePathDescription: tTool(runtime, "tools.multimodalParse.fieldFilePath"),
            attachmentIdentityDescription: tTool(
              runtime,
              "tools.multimodalParse.fieldAttachmentIdentity",
            ),
          }),
        )
        .min(1)
        .describe(tTool(runtime, "tools.multimodalParse.fieldInputs")),
      prompt: z.string().optional().describe(tTool(runtime, "tools.multimodalParse.fieldPrompt")),
      model_name: z
        .string()
        .optional()
        .describe(tTool(runtime, "tools.multimodalParse.fieldModelName")),
    }),
    func: async (
      { inputs: requestedInputs, prompt = "", model_name = "" },
      _runManager,
      toolConfig = {},
    ) => {
      const fileInputs = Array.isArray(requestedInputs) ? requestedInputs : [];
      if (!fileInputs.length) {
        throw recoverableToolError(tTool(runtime, "tools.multimodalParse.filePathsRequired"), {
          code: ERROR_CODE.RECOVERABLE_INPUT_MISSING,
        });
      }
      const resolvedInputs = await Promise.all(
        fileInputs.map(({ source }) =>
          resolveFileInput({
            source,
            agentContext,
            fieldName: "inputs",
            capability: PATH_CAPABILITIES.MULTIMODAL_INPUT,
          }),
        ),
      );
      const inputFiles = resolvedInputs.map((item) => item.executionPath);
      const inputs = resolvedInputs.map((item) => item.displayInput);
      const sourceAttachmentMetas = resolvedInputs.map((item) => item.sourceAttachmentMeta);
      const inputMimeTypes = inputFiles.map((inputFile, index) =>
        resolveMimeType(inputFile, sourceAttachmentMetas[index]),
      );
      const inputProcessing = inputMimeTypes.map(classifyModelInputProcessing);
      const directTextInputs = inputProcessing
        .map((processing, index) => ({
          processing,
          input: inputs[index],
          label:
            String(resolvedInputs[index]?.resourceRef?.logical?.path || "").trim() ||
            (typeof inputs[index] === "string"
              ? inputs[index]
              : JSON.stringify(inputs[index] || {})),
        }))
        .filter(({ processing }) => processing.kind === MODEL_INPUT_PROCESSING_KIND.DIRECT_TEXT);
      if (directTextInputs.length) {
        throw recoverableToolError(
          tTool(runtime, "tools.multimodalParse.directTextUnsupported", {
            inputs: directTextInputs.map(({ label }) => label).join(", "),
          }),
          {
            code: ERROR_CODE.RECOVERABLE_UNSUPPORTED_FILE_TYPE,
            details: {
              inputs: directTextInputs.map(({ input, processing }) => ({
                input,
                mimeType: processing.mimeType,
                processingKind: processing.kind,
              })),
            },
          },
        );
      }
      const requiredModalities = Array.from(
        new Set(inputProcessing.map(({ modality }) => modality)),
      );
      const inputFileStats = await Promise.all(inputFiles.map((filePath) => stat(filePath)));
      const totalFileSizeBytes = inputFileStats.reduce(
        (total, inputFileStat) => total + Number(inputFileStat.size || 0),
        0,
      );
      if (totalFileSizeBytes >= MAX_RESPONSES_FILE_INPUT_BYTES) {
        throw recoverableToolError(
          tTool(runtime, "tools.multimodalParse.fileTooLarge", {
            maxSizeMB: MAX_RESPONSES_FILE_INPUT_BYTES / (1000 * 1000),
          }),
          {
            code: ERROR_CODE.RECOVERABLE_ATTACHMENT_FILE_SIZE_LIMIT_EXCEEDED,
            details: {
              fileCount: inputFiles.length,
              totalFileSizeBytes,
              maxFileSizeBytesExclusive: MAX_RESPONSES_FILE_INPUT_BYTES,
            },
          },
        );
      }
      const { modelSpec, selection } = resolveConfiguredParseModel({
        modelName: model_name,
        requiredModalities,
        runtime,
      });
      if (!modelSpec) {
        const selectionError = selection?.conflicting
          ? tTool(runtime, "tools.multimodalParse.defaultModelConflict")
          : selection?.missingModalities?.length
            ? tTool(runtime, "tools.multimodalParse.defaultModelMissing", {
                modalities: selection.missingModalities.join(", "),
              })
            : tTool(runtime, "tools.multimodalParse.modelNotFound");
        throw recoverableToolError(selectionError, {
          code: ERROR_CODE.RECOVERABLE_MODEL_NOT_FOUND,
        });
      }
      const modelPort = runtime?.modelPort;
      if (!modelPort || typeof modelPort.invoke !== "function") {
        throw new TypeError("multimodal_parse requires runtime.modelPort");
      }
      const inputAttachments = await Promise.all(
        inputFiles.map(async (inputFile, index) => {
          const mimeType = inputMimeTypes[index];
          return {
            mimeType,
            data: `data:${mimeType};base64,${(await readFile(inputFile)).toString("base64")}`,
            fileName:
              String(sourceAttachmentMetas[index]?.name || "").trim() || path.basename(inputFile),
          };
        }),
      );
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
      const persistedOutput = await persistParsedTextAttachment({
        runtime,
        agentContext,
        inputFile: inputFiles[0],
        text,
        mode: TOOL_DATA_MODE.MULTIMODAL_MODEL,
        identity: toolConfig?.configurable?.transferIdentity,
      });
      const attachments = normalizePersistedAttachments(persistedOutput);
      if (attachments.length !== 1) {
        throw new Error("multimodal_parse_requires_one_persisted_result_attachment");
      }
      const [parsedAttachment] = attachments;
      const outputResources = registerTransferAttachmentResources({
        agentContext,
        transferEnvelopes: persistedOutput?.transferEnvelopes || [],
      });
      const updatedSourceAttachments = (
        await Promise.all(
          sourceAttachmentMetas.map(async (sourceAttachmentMeta) =>
            isUserAttachment(sourceAttachmentMeta)
              ? backwriteParsedAttachment({
                  runtime,
                  sourceAttachmentMeta,
                  parsedAttachment,
                })
              : null,
          ),
        )
      ).filter(Boolean);
      return toToolJsonResult(
        TOOL_NAME.MULTIMODAL_PARSE,
        {
          ok: true,
          status: TOOL_RESULT_STATUS.COMPLETED,
          mode: "openai_responses_api",
          inputs,
          resources: [...resolvedInputs.map((item) => item.resourceRef), ...outputResources],
          ...persistedOutput.resultFields,
          model: { alias: modelSpec.alias || "", name: modelSpec.model || "" },
          summary: {
            input_modalities: requiredModalities,
            source_attachment_identities: sourceAttachmentMetas
              .filter((attachment) => attachment !== null && attachment !== undefined)
              .map(projectAttachmentIdentity),
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
