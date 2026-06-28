/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

import path from "node:path";
import { Buffer } from "node:buffer";
import { v4 as uuidv4 } from "uuid";

import { fsMkdir, fsWriteFile } from "../../store/fs-adapter.js";
import { DEFAULT_MIME_TYPE } from "../constants.js";
import { safeStr } from "../../utils/shared-utils.js";
import { readAttachIndex, writeAttachIndex } from "../index-manager.js";
import { resolveAttachmentPolicy, isMimeTypeAllowed, isExtensionAllowed } from "../policy/policy-validator.js";
import { recoverableToolError } from "../../error/index.js";
import { tSystem } from "noobot-i18n/agent/system-text";
import { attachScopeRoot, resolveBasePath, resolveAttachmentScope } from "./path-resolver.js";
import { buildPublicRecord, normalizeExtension } from "./record-builder.js";
import { ERROR_CODE } from "../../error/constants.js";

function resolveConfigIsSandbox(config = {}) {
  const scriptConfig = config?.tools?.execute_script && typeof config.tools.execute_script === "object"
    ? config.tools.execute_script
    : {};
  return scriptConfig?.sandboxMode === true || scriptConfig?.sandbox_mode === true;
}

function resolveAttachmentIsSandbox(...sources) {
  for (const source of sources) {
    if (!source || typeof source !== "object" || Array.isArray(source)) continue;
    if (typeof source.isSandbox === "boolean") return source.isSandbox;
    if (typeof source.sandboxEnabled === "boolean") return source.sandboxEnabled;
  }
  return undefined;
}

export async function saveAttachmentRecord({
  basePath,
  attachmentIndex,
  scope,
  name,
  mimeType = DEFAULT_MIME_TYPE,
  contentBytes = Buffer.alloc(0),
  generatedByModel = false,
  generationSource = "",
  owner = null,
  turnScope = null,
  turnScopeId = "",
  dialogProcessId = "",
  isSandbox = undefined,
}) {
  const attachmentId = uuidv4();
  const extension = normalizeExtension(name, mimeType);
  const fileName = `${attachmentId}${extension}`;
  const savePath = path.join(attachScopeRoot(basePath, scope), fileName);

  await fsMkdir(path.dirname(savePath), { recursive: true });
  await fsWriteFile(savePath, contentBytes);

  const record = buildPublicRecord(basePath, {
    attachmentId,
    name: safeStr(name),
    mimeType: safeStr(mimeType, DEFAULT_MIME_TYPE),
    size: contentBytes.length,
    path: savePath,
    createdAt: new Date().toISOString(),
    sessionId: scope.sessionId,
    attachmentSource: scope.attachmentSource,
    generatedByModel,
    generationSource,
    owner,
    turnScope,
    turnScopeId,
    dialogProcessId,
    ...(typeof isSandbox === "boolean" ? { isSandbox } : {}),
  });

  attachmentIndex.attachments[attachmentId] = record;
  return record;
}

export async function ingestAttachments(service, { userId, sessionId = "", attachmentSource = "user", attachments, attachmentPolicy = {} }) {
  const basePath = resolveBasePath(service.globalConfig, userId);
  const defaultIsSandbox = resolveConfigIsSandbox(service.globalConfig);
  if (!attachments?.length) return [];

  const scope = resolveAttachmentScope({ sessionId, attachmentSource, requireSessionId: true });
  const policy = resolveAttachmentPolicy(attachmentPolicy);

  if (policy.maxFileCount > 0 && attachments.length > policy.maxFileCount) {
    throw recoverableToolError(
      `${tSystem("attach.countExceedsLimit")}: ${attachments.length} > ${policy.maxFileCount}`,
      {
        code: ERROR_CODE.RECOVERABLE_ATTACHMENT_COUNT_LIMIT_EXCEEDED,
        details: {
          receivedCount: attachments.length,
          maxFileCount: policy.maxFileCount,
          hint: tSystem("attach.hintIncreaseMaxFileCountOrReduceFiles"),
        },
      },
    );
  }

  const index = await readAttachIndex(basePath, scope);
  const saved = [];
  let totalBytes = 0;

  for (const item of attachments) {
    const { name, contentBase64, mimeType = DEFAULT_MIME_TYPE } = item;
    if (!name || !contentBase64) continue;

    const normalizedMime = safeStr(mimeType, DEFAULT_MIME_TYPE).toLowerCase();

    if (!isMimeTypeAllowed(normalizedMime, policy.allowedMimeTypes)) {
      throw recoverableToolError(`${tSystem("attach.mimeTypeNotAllowed")}: ${normalizedMime}`, {
        code: ERROR_CODE.RECOVERABLE_ATTACHMENT_MIME_TYPE_NOT_ALLOWED,
        details: { mimeType: normalizedMime },
      });
    }

    if (!isExtensionAllowed(safeStr(name), policy.allowedExtensions)) {
      throw recoverableToolError(`${tSystem("attach.extensionNotAllowed")}: ${safeStr(name)}`, {
        code: ERROR_CODE.RECOVERABLE_ATTACHMENT_EXTENSION_NOT_ALLOWED,
        details: {
          fileName: safeStr(name),
          allowedExtensions: policy.allowedExtensions,
          hint: tSystem("attach.hintAddExtensionToAllowedExtensions"),
        },
      });
    }

    const bytes = Buffer.from(contentBase64, "base64");

    if (policy.maxFileSizeBytes > 0 && bytes.length > policy.maxFileSizeBytes) {
      throw recoverableToolError(
        `${tSystem("attach.fileTooLarge")}: ${safeStr(name)}, ${bytes.length} > ${policy.maxFileSizeBytes}`,
        {
          code: ERROR_CODE.RECOVERABLE_ATTACHMENT_FILE_SIZE_LIMIT_EXCEEDED,
          details: {
            fileName: safeStr(name),
            fileSizeBytes: bytes.length,
            maxFileSizeBytes: policy.maxFileSizeBytes,
            hint: tSystem("attach.hintIncreaseMaxFileSizeOrUploadSmaller"),
          },
        },
      );
    }

    totalBytes += bytes.length;
    if (policy.maxTotalSizeBytes > 0 && totalBytes > policy.maxTotalSizeBytes) {
      throw recoverableToolError(
        `${tSystem("attach.totalSizeExceedsLimit")}: ${totalBytes} > ${policy.maxTotalSizeBytes}`,
        {
          code: ERROR_CODE.RECOVERABLE_ATTACHMENT_TOTAL_SIZE_LIMIT_EXCEEDED,
          details: {
            totalSizeBytes: totalBytes,
            maxTotalSizeBytes: policy.maxTotalSizeBytes,
            hint: tSystem("attach.hintIncreaseMaxTotalSizeOrReduceUpload"),
          },
        },
      );
    }

    const record = await saveAttachmentRecord({
      basePath,
      attachmentIndex: index,
      scope,
      name,
      mimeType: normalizedMime,
      contentBytes: bytes,
      isSandbox: resolveAttachmentIsSandbox(item) ?? defaultIsSandbox,
    });
    saved.push(record);
  }

  await writeAttachIndex(basePath, index, scope);
  return saved;
}

export async function ingestGeneratedArtifacts(service, {
  userId,
  sessionId = "",
  attachmentSource = "model",
  artifacts = [],
  generationSource = "llm_output",
  owner = null,
  turnScope = null,
  turnScopeId = "",
  dialogProcessId = "",
}) {
  const basePath = resolveBasePath(service.globalConfig, userId);
  const defaultIsSandbox = resolveConfigIsSandbox(service.globalConfig);
  const list = Array.isArray(artifacts) ? artifacts : [];
  if (!list.length) return [];

  const scope = resolveAttachmentScope({ sessionId, attachmentSource, requireSessionId: true });
  const index = await readAttachIndex(basePath, scope);
  const saved = [];

  for (const item of list) {
    const artifactName = safeStr(item?.name);
    const artifactContent = safeStr(item?.contentBase64);
    if (!artifactName || !artifactContent) continue;

    const record = await saveAttachmentRecord({
      basePath,
      attachmentIndex: index,
      scope,
      name: artifactName,
      mimeType: safeStr(item?.mimeType, DEFAULT_MIME_TYPE).toLowerCase(),
      contentBytes: Buffer.from(artifactContent, "base64"),
      generatedByModel: true,
      generationSource,
      owner: item?.owner && typeof item.owner === "object" && !Array.isArray(item.owner)
        ? item.owner
        : owner,
      turnScope: item?.turnScope && typeof item.turnScope === "object" && !Array.isArray(item.turnScope)
        ? item.turnScope
        : turnScope,
      turnScopeId: safeStr(item?.turnScopeId || turnScopeId),
      dialogProcessId: safeStr(item?.dialogProcessId || item?.dialog_process_id || dialogProcessId),
      isSandbox: resolveAttachmentIsSandbox(item, item?.meta) ?? defaultIsSandbox,
    });
    saved.push(record);
  }

  await writeAttachIndex(basePath, index, scope);
  return saved;
}

export async function ingestEmailArtifacts(service, { userId, sessionId = "", artifacts = [] } = {}) {
  return ingestGeneratedArtifacts(service, {
    userId,
    sessionId,
    attachmentSource: "email",
    artifacts,
    generationSource: "email_connector_read",
  });
}
