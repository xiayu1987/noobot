/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { DynamicStructuredTool } from "@langchain/core/tools";
import { z } from "zod";
import { recoverableToolError } from "../../shared/errors/index.js";
import { getRuntimeFromAgentContext } from "../../context/agent-context-accessor.js";
import { assertAndResolveUserWorkspaceFilePath } from "../core/check-tool-input.js";
import { toToolJsonResult } from "../core/tool-json-result.js";
import { tTool } from "../core/tool-i18n.js";
import { ERROR_CODE } from "../../shared/errors/constants.js";
import { TOOL_DATA_MODE, TOOL_NAME, TOOL_RESULT_STATUS } from "../constants/index.js";
import {
  decodeLibreOfficeTextBuffer,
  parseDocumentToTextViaLibreOffice,
} from "./doc2data/libreoffice.js";
import {
  backwriteFirstAttachment,
  buildExistingArtifactPersistedOutput,
  isGeneratedDataProcessingArtifact,
  normalizePersistedAttachments,
  persistDoc2DataTextAttachment,
} from "./doc2data/artifacts.js";
import {
  isImageInputFile,
  isLegacyDocInputFile,
  readDirectTextDocumentIfAvailable,
  resolveDocInputAttachmentMeta,
} from "./doc2data/document-input.js";

export { decodeLibreOfficeTextBuffer };

export function createDoc2DataTool({ agentContext }) {
  const runtime = getRuntimeFromAgentContext(agentContext);
  const basePath = String(runtime.basePath || "").trim();
  if (!basePath) return [];

  const doc2dataTool = new DynamicStructuredTool({
    name: TOOL_NAME.DOC_TO_DATA,
    description: tTool(runtime, "tools.doc2data.description"),
    schema: z.object({
      filePath: z.string().describe(tTool(runtime, "tools.doc2data.fieldFilePath")),
      attachmentId: z
        .string()
        .optional()
        .describe("Canonical source attachment ID when the input is a session attachment."),
    }),
    func: async ({ filePath, attachmentId }, _runManager, toolConfig = {}) => {
      const transferIdentity = toolConfig?.configurable?.transferIdentity;
      const inputFile = await assertAndResolveUserWorkspaceFilePath({
        filePath,
        agentContext,
        fieldName: "filePath",
        mustExist: true,
      });
      const sourceAttachmentMeta = await resolveDocInputAttachmentMeta(agentContext, attachmentId);
      const generatedArtifactMeta = isGeneratedDataProcessingArtifact(sourceAttachmentMeta)
        ? sourceAttachmentMeta
        : null;
      if (isImageInputFile(inputFile)) {
        throw recoverableToolError(tTool(runtime, "tools.doc2data.imageFileUseMultimodalParse"), {
          code: ERROR_CODE.RECOVERABLE_UNSUPPORTED_FILE_TYPE,
          details: { input: inputFile },
        });
      }
      if (isLegacyDocInputFile(inputFile)) {
        throw recoverableToolError(tTool(runtime, "tools.doc2data.libreofficeDocUnsupported"), {
          code: ERROR_CODE.RECOVERABLE_UNSUPPORTED_FILE_TYPE,
          details: { input: inputFile },
        });
      }

      const directTextDocument = await readDirectTextDocumentIfAvailable(inputFile);
      if (directTextDocument) {
        if (generatedArtifactMeta) {
          const persistedOutput = buildExistingArtifactPersistedOutput({
            runtime,
            agentContext,
            attachmentMeta: generatedArtifactMeta,
            text: directTextDocument.text,
            identity: transferIdentity,
          });
          const attachments = normalizePersistedAttachments(persistedOutput);
          return toToolJsonResult(
            TOOL_NAME.DOC_TO_DATA,
            {
              ok: true,
              status: TOOL_RESULT_STATUS.COMPLETED,
              message:
                "输入已经是数据处理生成的中间产物，已复用原文件；未超过限制时直接返回 text，超过限制时返回预览，避免递归复制。",
              mode: TOOL_DATA_MODE.DIRECT_TEXT,
              input: inputFile,
              reusedExistingArtifact: true,
              ...persistedOutput.resultFields,
              summary: {
                bytes: Number(directTextDocument.bytes || 0),
                parsed_from_attachment_id: String(generatedArtifactMeta?.attachmentId || ""),
                source_attachment_backwritten: false,
                saved_attachment_count: attachments.length,
                text_length: directTextDocument.text.length,
              },
            },
            true,
          );
        }
        const persistedOutput = await persistDoc2DataTextAttachment({
          runtime,
          agentContext,
          inputFile,
          text: directTextDocument.text,
          mode: TOOL_DATA_MODE.DIRECT_TEXT,
          identity: transferIdentity,
        });
        const attachments = normalizePersistedAttachments(persistedOutput);
        const updatedSourceAttachment = await backwriteFirstAttachment({
          runtime,
          sourceAttachmentMeta,
          attachments,
        });
        return toToolJsonResult(
          TOOL_NAME.DOC_TO_DATA,
          {
            ok: true,
            status: TOOL_RESULT_STATUS.COMPLETED,
            message:
              "内容已通过 semantic-transfer 保存到附件；未超过限制时同时直接返回 text，超过限制时返回预览。",
            mode: TOOL_DATA_MODE.DIRECT_TEXT,
            input: inputFile,
            ...persistedOutput.resultFields,
            summary: {
              bytes: Number(directTextDocument.bytes || 0),
              parsed_from_attachment_id: String(sourceAttachmentMeta?.attachmentId || ""),
              source_attachment_backwritten: Boolean(updatedSourceAttachment),
              saved_attachment_count: attachments.length,
              text_length: directTextDocument.text.length,
            },
          },
          true,
        );
      }

      const libreOfficeResult = await parseDocumentToTextViaLibreOffice({
        runtime,
        inputFile,
        sourceAttachmentMeta,
      });
      const persistedOutput = await persistDoc2DataTextAttachment({
        runtime,
        agentContext,
        inputFile,
        text: libreOfficeResult.text,
        mode: libreOfficeResult.mode || "libreoffice_text",
        identity: transferIdentity,
      });
      const attachments = normalizePersistedAttachments(persistedOutput);
      const updatedSourceAttachment = await backwriteFirstAttachment({
        runtime,
        sourceAttachmentMeta,
        attachments,
      });

      return toToolJsonResult(
        TOOL_NAME.DOC_TO_DATA,
        {
          ok: true,
          status: TOOL_RESULT_STATUS.COMPLETED,
          message:
            "内容已通过 semantic-transfer 保存到附件；未超过限制时同时直接返回 text，超过限制时返回预览。",
          mode: libreOfficeResult.mode || "libreoffice_text",
          input: inputFile,
          ...persistedOutput.resultFields,
          summary: {
            bytes: Number(libreOfficeResult.bytes || 0),
            libreoffice_output_format: String(libreOfficeResult.outputFormat || ""),
            parsed_from_attachment_id: String(sourceAttachmentMeta?.attachmentId || ""),
            source_attachment_backwritten: Boolean(updatedSourceAttachment),
            saved_attachment_count: attachments.length,
            text_length: libreOfficeResult.text.length,
          },
        },
        true,
      );
    },
  });

  return [doc2dataTool];
}
