/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { readFile } from "node:fs/promises";
import { ATTACHMENT_SOURCE, normalizeSourcePath } from "@noobot/attachment-protocol";
import { resolveMimeTypeFromFileName } from "@noobot/attachment-protocol/mime";
import { resolveAttachmentPolicy } from "@noobot/agent-config-protocol";
import { PATH_CAPABILITIES, filePath as path } from "@noobot/path-resolver";
import { TRANSFER_REASON } from "@noobot/semantic-transfer-protocol";
import { tSystem } from "noobot-i18n/agent/system-text";
import { recoverableToolError } from "../../../shared/errors/index.js";
import { ERROR_CODE } from "../../../shared/errors/constants.js";
import { persistTransferArtifacts } from "../../../transfer-adapter/index.js";
import { resolveAuthorizedUserWorkspaceFilePath } from "../../core/check-tool-input.js";

function assertWithinLimit({ value, limit, code, message, details }) {
  if (value <= limit) return;
  throw recoverableToolError(message, { code, details });
}

export async function assertScriptOutputFilesAuthorized({ agentContext, outputFiles = [] } = {}) {
  for (const declaredPath of outputFiles) {
    normalizeSourcePath(declaredPath);
    await resolveAuthorizedUserWorkspaceFilePath({
      filePath: declaredPath,
      agentContext,
      fieldName: "outputFiles",
      mustExist: false,
      capability: PATH_CAPABILITIES.SCRIPT_OUTPUT,
    });
  }
}

export async function persistScriptOutputFiles({
  agentContext,
  runtime,
  identity,
  outputFiles = [],
} = {}) {
  if (!outputFiles.length) return [];
  const policy = resolveAttachmentPolicy(runtime.globalConfig);
  assertWithinLimit({
    value: outputFiles.length,
    limit: policy.maxFileCount,
    code: ERROR_CODE.RECOVERABLE_ATTACHMENT_COUNT_LIMIT_EXCEEDED,
    message: `${tSystem("attach.countExceedsLimit")}: ${outputFiles.length} > ${policy.maxFileCount}`,
    details: { receivedCount: outputFiles.length, maxFileCount: policy.maxFileCount },
  });
  const artifacts = [];
  let totalBytes = 0;
  for (const declaredPath of outputFiles) {
    const sourcePath = normalizeSourcePath(declaredPath);
    const resolution = await resolveAuthorizedUserWorkspaceFilePath({
      filePath: declaredPath,
      agentContext,
      fieldName: "outputFiles",
      mustExist: true,
      capability: PATH_CAPABILITIES.SCRIPT_OUTPUT,
    });
    const bytes = await readFile(resolution.resourcePath);
    const name = path.basename(resolution.executionPath);
    assertWithinLimit({
      value: bytes.length,
      limit: policy.maxFileSizeBytes,
      code: ERROR_CODE.RECOVERABLE_ATTACHMENT_FILE_SIZE_LIMIT_EXCEEDED,
      message: `${tSystem("attach.fileTooLarge")}: ${name}, ${bytes.length} > ${policy.maxFileSizeBytes}`,
      details: {
        fileName: name,
        fileSizeBytes: bytes.length,
        maxFileSizeBytes: policy.maxFileSizeBytes,
      },
    });
    totalBytes += bytes.length;
    assertWithinLimit({
      value: totalBytes,
      limit: policy.maxTotalSizeBytes,
      code: ERROR_CODE.RECOVERABLE_ATTACHMENT_TOTAL_SIZE_LIMIT_EXCEEDED,
      message: `${tSystem("attach.totalSizeExceedsLimit")}: ${totalBytes} > ${policy.maxTotalSizeBytes}`,
      details: { totalSizeBytes: totalBytes, maxTotalSizeBytes: policy.maxTotalSizeBytes },
    });
    artifacts.push({
      name,
      mimeType: resolveMimeTypeFromFileName(name),
      contentBase64: bytes.toString("base64"),
      sourcePath,
      meta: { role: "output_file" },
    });
  }
  const persisted = await persistTransferArtifacts({
    runtime,
    artifacts,
    attachmentSource: ATTACHMENT_SOURCE.MODEL,
    generationSource: TRANSFER_REASON.EXECUTE_SCRIPT_OUTPUT_FILES,
    source: "tool",
    reason: TRANSFER_REASON.EXECUTE_SCRIPT_OUTPUT_FILES,
    identity,
    intent: {
      source: "tool",
      reason: TRANSFER_REASON.EXECUTE_SCRIPT_OUTPUT_FILES,
      scenario: "tool",
      strategy: "tool_output",
    },
    meta: { contentOmitted: true },
  });
  return persisted.transferEnvelopes;
}
