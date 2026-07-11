/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { filePath as path } from "../../utils/path-resolver.js";
import { DynamicStructuredTool } from "@langchain/core/tools";
import { z } from "zod";
import { DOC2DATA_PARSE_ENGINE } from "../../config/core/enums.js";
import { MIME_TYPE } from "../../constants/index.js";
import { recoverableToolError } from "../../error/index.js";
import { invokeModelWithTextAndAttachments, resolveModelSpecByAlias } from "../../model/index.js";
import { getRuntimeFromAgentContext } from "../../context/agent-context-accessor.js";
import { convertDocumentToImages } from "../../utils/doc/doc2img.js";
import { assertAndResolveUserWorkspaceFilePath } from "../core/check-tool-input.js";
import { toToolJsonResult } from "../core/tool-json-result.js";
import { tTool } from "../core/tool-i18n.js";
import { ERROR_CODE } from "../../error/constants.js";
import { isAbortError } from "../../utils/error-utils.js";
import {
  RUNTIME_EVENT_CATEGORIES,
  RUNTIME_EVENT_CHANNELS,
  writeRoutedRuntimeEvent,
} from "@noobot/runtime-events";
import { TOOL_DATA_MODE, TOOL_NAME, TOOL_RESULT_STATUS } from "../constants/index.js";
import { LENGTH_THRESHOLDS } from "@noobot/shared/length-thresholds";
import { decodeLibreOfficeTextBuffer, parseDocumentToTextViaLibreOffice } from "./doc2data/libreoffice.js";
import {
  backwriteFirstAttachment,
  buildExistingArtifactPersistedOutput,
  buildFallbackArtifactMeta,
  isGeneratedDataProcessingArtifact,
  looksLikeDataProcessingArtifactPath,
  normalizePersistedAttachments,
  persistDoc2DataTextAttachment,
} from "./doc2data/artifacts.js";
import {
  buildImageBatches,
  isImageInputFile,
  isLegacyDocInputFile,
  normalizeModelOutput,
  readDirectTextDocumentIfAvailable,
  resolveAttachmentAliasByType,
  resolveDoc2DataParseEngine,
  resolveDoc2DataPrompt,
  resolveDocInputAttachmentMeta,
  resolveMimeTypeByPath,
} from "./doc2data/vision.js";

const MAX_BATCH_BYTES = LENGTH_THRESHOLDS.dataProcessing.batchBytes;

export { decodeLibreOfficeTextBuffer };

function resolveGeneratedDataProcessingArtifactMeta(inputFile = "", runtime = {}) {
  const normalizedInputPath = String(inputFile || "").trim();
  if (!normalizedInputPath) return null;
  const generatedAttachmentMetas = Array.isArray(runtime?.attachments) ? runtime.attachments : [];
  if (!generatedAttachmentMetas.length) return null;
  const inputBaseName = path.basename(normalizedInputPath);
  const inputAttachmentId = String(inputBaseName || "").split(".")[0];
  return generatedAttachmentMetas.find((attachmentItem) => {
    if (!isGeneratedDataProcessingArtifact(attachmentItem)) return false;
    const metaPath = String(attachmentItem?.path || "").trim();
    const metaRelativePath = String(attachmentItem?.relativePath || "").trim();
    const metaBaseName = path.basename(metaPath || metaRelativePath);
    const metaAttachmentId = String(attachmentItem?.attachmentId || "").trim();
    return (
      (metaPath && metaPath === normalizedInputPath) ||
      (metaRelativePath && metaRelativePath === normalizedInputPath) ||
      (inputBaseName && metaBaseName === inputBaseName) ||
      (inputAttachmentId && metaAttachmentId && inputAttachmentId === metaAttachmentId)
    );
  }) || null;
}

async function recordDoc2DataLibreOfficeFallback({
  runtime = {},
  inputFile = "",
  error = null,
} = {}) {
  const userId = String(runtime?.userId || "").trim();
  const sessionId = String(
    runtime?.systemRuntime?.sessionId || runtime?.systemRuntime?.rootSessionId || "",
  ).trim();
  const systemRuntime = runtime?.systemRuntime || {};
  const dialogProcessId = String(systemRuntime?.dialogProcessId || systemRuntime?.currentDialogProcessId || "").trim();
  const turnScopeId = String(systemRuntime?.turnScopeId || systemRuntime?.config?.turnScopeId || "").trim();
  if (!sessionId) return { ok: true, skipped: true };
  const inputValue = String(inputFile || "");
  return writeRoutedRuntimeEvent({
    scope: "session",
    source: "agent",
    channel: RUNTIME_EVENT_CHANNELS.DIRECT,
    category: RUNTIME_EVENT_CATEGORIES.SYSTEM,
    event: "agent.doc2data.libreofficeFallbackToVision",
    userId,
    sessionId,
    ...(dialogProcessId ? { dialogProcessId } : {}),
    ...(turnScopeId ? { turnScopeId } : {}),
    data: {
      inputFileName: path.basename(inputValue),
      inputPathLength: inputValue.length,
      errorName: String(error?.name || ""),
      errorCode: String(error?.code || ""),
      errorMessage: error?.message || String(error || ""),
      parseEngine: DOC2DATA_PARSE_ENGINE.LIBREOFFICE,
    },
  }, {
    workspaceRoot: runtime?.globalConfig?.workspaceRoot || "",
  });
}

export function createDoc2DataTool({ agentContext }) {
  const runtime = getRuntimeFromAgentContext(agentContext);
  const basePath = agentContext?.environment?.workspace?.basePath || runtime.basePath || "";
  const globalConfig = runtime.globalConfig || {};
  const userConfig = runtime.userConfig || {};
  if (!basePath) return [];

  const doc2dataTool = new DynamicStructuredTool({
    name: TOOL_NAME.DOC_TO_DATA,
    description: tTool(runtime, "tools.doc2data.description"),
    schema: z.object({
      filePath: z.string().describe(tTool(runtime, "tools.doc2data.fieldFilePath")),
      attachmentId: z.string().optional().describe("Canonical source attachment ID when the input is a session attachment."),
      prompt: z.string().optional().describe(tTool(runtime, "tools.doc2data.fieldPrompt")),
      dpi: z.number().optional().describe(tTool(runtime, "tools.doc2data.fieldDpi")),
      parseEngine: z.string().optional().describe(tTool(runtime, "tools.doc2data.fieldParseEngine")),
    }),
    func: async ({ filePath, attachmentId, prompt, dpi, parseEngine }) => {
      const resolvedParseEngine = resolveDoc2DataParseEngine(runtime, parseEngine, userConfig, globalConfig);
      const normalizedDpi = Number(dpi);
      const resolvedDpi = Number.isFinite(normalizedDpi) && normalizedDpi > 0 ? Math.floor(normalizedDpi) : 180;
      let effectiveParseEngine = resolvedParseEngine;
      const inputFile = await assertAndResolveUserWorkspaceFilePath({ filePath, agentContext, fieldName: "filePath", mustExist: true });
      const sourceAttachmentMeta = await resolveDocInputAttachmentMeta(inputFile, agentContext, attachmentId);
      const generatedArtifactMeta = resolveGeneratedDataProcessingArtifactMeta(inputFile, runtime);
      if (isImageInputFile(inputFile)) {
        throw recoverableToolError(tTool(runtime, "tools.doc2data.imageFileUseMedia2Data"), {
          code: ERROR_CODE.RECOVERABLE_UNSUPPORTED_FILE_TYPE,
          details: { input: inputFile },
        });
      }
      if (resolvedParseEngine === DOC2DATA_PARSE_ENGINE.LIBREOFFICE && isLegacyDocInputFile(inputFile)) {
        throw recoverableToolError(tTool(runtime, "tools.doc2data.libreofficeDocUnsupported"), {
          code: ERROR_CODE.RECOVERABLE_UNSUPPORTED_FILE_TYPE,
          details: { input: inputFile, parseEngine: resolvedParseEngine },
        });
      }

      const directTextDocument = await readDirectTextDocumentIfAvailable(inputFile);
      if (directTextDocument) {
        if (generatedArtifactMeta || looksLikeDataProcessingArtifactPath(inputFile)) {
          const reusableAttachmentMeta = generatedArtifactMeta || buildFallbackArtifactMeta({ runtime, basePath, inputFile, bytes: directTextDocument.bytes });
          const persistedOutput = buildExistingArtifactPersistedOutput({ runtime, agentContext, attachmentMeta: reusableAttachmentMeta, text: directTextDocument.text });
          const attachments = normalizePersistedAttachments(persistedOutput);
          return toToolJsonResult(TOOL_NAME.DOC_TO_DATA, {
            ok: true,
            status: TOOL_RESULT_STATUS.COMPLETED,
            message: "输入已经是数据处理生成的中间产物，已复用原文件；未超过限制时直接返回 text，超过限制时返回预览，避免递归复制。",
            mode: TOOL_DATA_MODE.DIRECT_TEXT,
            input: inputFile,
            reusedExistingArtifact: true,
            ...persistedOutput.resultFields,
            summary: {
              bytes: Number(directTextDocument.bytes || 0),
              parse_engine: resolvedParseEngine,
              parsed_from_attachment_id: String(reusableAttachmentMeta?.attachmentId || ""),
              parsed_result_path: String(reusableAttachmentMeta?.path || inputFile || ""),
              source_attachment_backwritten: false,
              saved_attachment_count: attachments.length,
              text_length: directTextDocument.text.length,
            },
          }, true);
        }
        const persistedOutput = await persistDoc2DataTextAttachment({ runtime, agentContext, inputFile, text: directTextDocument.text, mode: TOOL_DATA_MODE.DIRECT_TEXT });
        const attachments = normalizePersistedAttachments(persistedOutput);
        const updatedSourceAttachment = await backwriteFirstAttachment({ runtime, sourceAttachmentMeta, attachments });
        return toToolJsonResult(TOOL_NAME.DOC_TO_DATA, {
          ok: true,
          status: TOOL_RESULT_STATUS.COMPLETED,
          message: "内容已通过 semantic-transfer 保存到附件；未超过限制时同时直接返回 text，超过限制时返回预览。",
          mode: TOOL_DATA_MODE.DIRECT_TEXT,
          input: inputFile,
          ...persistedOutput.resultFields,
          summary: {
            bytes: Number(directTextDocument.bytes || 0),
            parse_engine: resolvedParseEngine,
            parsed_from_attachment_id: String(sourceAttachmentMeta?.attachmentId || ""),
            parsed_result_path: String(attachments?.[0]?.path || ""),
            source_attachment_backwritten: Boolean(updatedSourceAttachment),
            saved_attachment_count: attachments.length,
            text_length: directTextDocument.text.length,
          },
        }, true);
      }

      if (resolvedParseEngine === DOC2DATA_PARSE_ENGINE.LIBREOFFICE) {
        try {
          const libreOfficeResult = await parseDocumentToTextViaLibreOffice({ runtime, inputFile, sourceAttachmentMeta });
          const persistedOutput = await persistDoc2DataTextAttachment({ runtime, agentContext, inputFile, text: libreOfficeResult.text, mode: libreOfficeResult.mode || "libreoffice_text" });
          const attachments = normalizePersistedAttachments(persistedOutput);
          const updatedSourceAttachment = await backwriteFirstAttachment({ runtime, sourceAttachmentMeta, attachments });
          return toToolJsonResult(TOOL_NAME.DOC_TO_DATA, {
            ok: true,
            status: TOOL_RESULT_STATUS.COMPLETED,
            message: "内容已通过 semantic-transfer 保存到附件；未超过限制时同时直接返回 text，超过限制时返回预览。",
            mode: libreOfficeResult.mode || "libreoffice_text",
            input: inputFile,
            ...persistedOutput.resultFields,
            summary: {
              bytes: Number(libreOfficeResult.bytes || 0),
              parse_engine: resolvedParseEngine,
              libreoffice_output_format: String(libreOfficeResult.outputFormat || ""),
              parsed_from_attachment_id: String(sourceAttachmentMeta?.attachmentId || ""),
              parsed_result_path: String(attachments?.[0]?.path || ""),
              source_attachment_backwritten: Boolean(updatedSourceAttachment),
              saved_attachment_count: attachments.length,
              text_length: libreOfficeResult.text.length,
            },
          }, true);
        } catch (libreOfficeError) {
          if (isAbortError(libreOfficeError)) throw libreOfficeError;
          effectiveParseEngine = DOC2DATA_PARSE_ENGINE.VISION;
          await recordDoc2DataLibreOfficeFallback({
            runtime,
            inputFile,
            error: libreOfficeError,
          }).catch(() => {});
        }
      }

      const outputRoot = path.join(basePath, "runtime", "workspace", ".doc2data");
      const converted = await convertDocumentToImages({ inputFile, outputRoot, format: "png", dpi: resolvedDpi });
      const images = converted.imagePaths || [];
      if (!images.length) {
        throw recoverableToolError(tTool(runtime, "tools.doc2data.noImagesProduced"), {
          code: ERROR_CODE.RECOVERABLE_DOC2DATA_NO_IMAGES_PRODUCED,
          details: { input: converted.input },
        });
      }
      const imageAlias = resolveAttachmentAliasByType({ globalConfig, userConfig, mediaType: "image" });
      const modelSpec = resolveModelSpecByAlias({ alias: imageAlias, globalConfig, userConfig, fallbackToDefault: true });
      const userPrompt = resolveDoc2DataPrompt(runtime, prompt);
      const imageBatches = await buildImageBatches(images);
      const batchResults = [];
      for (let batchIndex = 0; batchIndex < imageBatches.length; batchIndex += 1) {
        const batch = imageBatches[batchIndex];
        const pageNumbers = batch.map((imageItem) => imageItem.page);
        const range = `${pageNumbers[0]}-${pageNumbers[pageNumbers.length - 1]}`;
        const modelResult = await invokeModelWithTextAndAttachments({
          modelName: modelSpec?.alias || modelSpec?.model,
          text: `${userPrompt}\n\n${tTool(runtime, "tools.doc2data.batchPrompt", { batchIndex: batchIndex + 1, range })}`,
          attachments: batch.map((imageItem) => ({ type: resolveMimeTypeByPath(imageItem.imagePath, "image"), mimeType: resolveMimeTypeByPath(imageItem.imagePath, "image"), data: imageItem.dataUrl })),
          globalConfig,
          userConfig,
          streaming: false,
        });
        const text = normalizeModelOutput(modelResult?.response?.content);
        batchResults.push({ batch: batchIndex + 1, pages: pageNumbers, totalBytes: batch.reduce((sum, item) => sum + item.sizeBytes, 0), text });
      }
      const mergedText = batchResults.map((batchResult) => batchResult.text).join("\n\n");
      const totalImageBytes = imageBatches.flatMap((batch) => batch).reduce((sum, item) => sum + Number(item?.sizeBytes || 0), 0);
      const persistedOutput = await persistDoc2DataTextAttachment({ runtime, agentContext, inputFile, text: mergedText, mode: TOOL_DATA_MODE.IMAGE_MODEL });
      const attachments = normalizePersistedAttachments(persistedOutput);
      const updatedSourceAttachment = await backwriteFirstAttachment({ runtime, sourceAttachmentMeta, attachments });

      return toToolJsonResult(TOOL_NAME.DOC_TO_DATA, {
        ok: true,
        status: TOOL_RESULT_STATUS.COMPLETED,
        message: "内容已通过 semantic-transfer 保存到附件；未超过限制时同时直接返回 text，超过限制时返回预览。",
        mode: TOOL_DATA_MODE.IMAGE_MODEL,
        input: converted.input,
        pdfPath: converted.pdfPath,
        imageCount: images.length,
        ...persistedOutput.resultFields,
        model: { alias: modelSpec?.alias || "", name: modelSpec?.model || "" },
        summary: {
          batch_count: batchResults.length,
          parse_engine: effectiveParseEngine,
          parsed_from_attachment_id: String(sourceAttachmentMeta?.attachmentId || ""),
          parsed_result_path: String(attachments?.[0]?.path || ""),
          source_attachment_backwritten: Boolean(updatedSourceAttachment),
          total_image_bytes: totalImageBytes,
          batch_max_bytes: MAX_BATCH_BYTES,
          saved_attachment_count: attachments.length,
          text_length: mergedText.length,
          pages: batchResults.flatMap((item) => item.pages || []),
        },
      }, true);
    },
  });

  return [doc2dataTool];
}
