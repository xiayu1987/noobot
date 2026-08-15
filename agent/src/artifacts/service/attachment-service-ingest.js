/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

import { filePath as path } from "@noobot/path-resolver";
import { Buffer } from "node:buffer";
import { createHash } from "node:crypto";
import { v4 as uuidv4 } from "uuid";

import { fsMkdir, fsWriteFile } from "../../shared/storage/fs-adapter.js";
import { DEFAULT_MIME_TYPE } from "../constants.js";
import { safeStr } from "../../shared/utils/shared-utils.js";
import { readAttachIndex, withAttachIndexLock, writeAttachIndex } from "../index-manager.js";
import {
  resolveAttachmentPolicy,
  isMimeTypeAllowed,
  isExtensionAllowed,
} from "../policy/policy-validator.js";
import { recoverableToolError } from "../../shared/errors/index.js";
import { tSystem } from "noobot-i18n/agent/system-text";
import {
  attachScopeRoot,
  resolveBasePath,
  resolveAttachmentScope,
} from "./attachment-scope-resolver.js";
import { buildPublicRecord, normalizeExtension } from "./record-builder.js";
import { ERROR_CODE } from "../../shared/errors/constants.js";

function resolveAttachmentIsSandbox(...sources) {
  for (const source of sources) {
    if (!source || typeof source !== "object" || Array.isArray(source)) continue;
    if (typeof source.isSandbox === "boolean") return source.isSandbox;
    if (typeof source.sandboxEnabled === "boolean") return source.sandboxEnabled;
  }
  return undefined;
}

function requireArtifactEntries(items, label) {
  return items.map((item, index) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) {
      throw new TypeError(`${label}[${index}] must be an object`);
    }
    const name = safeStr(item.name);
    if (!name) throw new TypeError(`${label}[${index}].name is required`);
    if (typeof item.contentBase64 !== "string") {
      throw new TypeError(`${label}[${index}].contentBase64 must be a string`);
    }
    return { item, name, contentBase64: item.contentBase64 };
  });
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
  clientAttachmentId = "",
  contentSha256 = "",
}) {
  const attachmentId = uuidv4();
  const extension = normalizeExtension(name, mimeType);
  const fileName = `${attachmentId}${extension}`;
  const savePath = path.join(attachScopeRoot(basePath, scope), fileName);

  await fsMkdir(path.dirname(savePath), { recursive: true });
  await fsWriteFile(savePath, contentBytes);

  const record = buildPublicRecord(basePath, {
    attachmentId,
    clientAttachmentId,
    contentSha256,
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

export async function ingestAttachments(
  service,
  { userId, sessionId = "", attachmentSource = "user", attachments, attachmentPolicy = {} },
) {
  const basePath = resolveBasePath(service.globalConfig, userId);
  if (!attachments?.length) return [];

  const scope = resolveAttachmentScope({ sessionId, attachmentSource, requireSessionId: true });
  const policy = resolveAttachmentPolicy(attachmentPolicy);
  const entries = requireArtifactEntries(attachments, "attachments");

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

  const prepared = entries.map(({ item, name, contentBase64 }) => {
    const normalizedMime = safeStr(item.mimeType, DEFAULT_MIME_TYPE).toLowerCase();
    if (!isMimeTypeAllowed(normalizedMime, policy.allowedMimeTypes)) {
      throw recoverableToolError(`${tSystem("attach.mimeTypeNotAllowed")}: ${normalizedMime}`, {
        code: ERROR_CODE.RECOVERABLE_ATTACHMENT_MIME_TYPE_NOT_ALLOWED,
        details: { mimeType: normalizedMime },
      });
    }
    if (!isExtensionAllowed(name, policy.allowedExtensions)) {
      throw recoverableToolError(`${tSystem("attach.extensionNotAllowed")}: ${name}`, {
        code: ERROR_CODE.RECOVERABLE_ATTACHMENT_EXTENSION_NOT_ALLOWED,
        details: {
          fileName: name,
          allowedExtensions: policy.allowedExtensions,
          hint: tSystem("attach.hintAddExtensionToAllowedExtensions"),
        },
      });
    }
    const bytes = Buffer.from(contentBase64, "base64");
    if (policy.maxFileSizeBytes > 0 && bytes.length > policy.maxFileSizeBytes) {
      throw recoverableToolError(
        `${tSystem("attach.fileTooLarge")}: ${name}, ${bytes.length} > ${policy.maxFileSizeBytes}`,
        {
          code: ERROR_CODE.RECOVERABLE_ATTACHMENT_FILE_SIZE_LIMIT_EXCEEDED,
          details: {
            fileName: name,
            fileSizeBytes: bytes.length,
            maxFileSizeBytes: policy.maxFileSizeBytes,
            hint: tSystem("attach.hintIncreaseMaxFileSizeOrUploadSmaller"),
          },
        },
      );
    }
    return { item, name, normalizedMime, bytes };
  });
  const totalBytes = prepared.reduce((sum, entry) => sum + entry.bytes.length, 0);
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

  return withAttachIndexLock(basePath, scope, async () => {
    const index = await readAttachIndex(basePath, scope);
    const saved = [];

    for (const { item, name, normalizedMime, bytes } of prepared) {
      const clientAttachmentId = safeStr(item?.clientAttachmentId);
      const contentSha256 = createHash("sha256").update(bytes).digest("hex");
      if (clientAttachmentId) {
        const existing = Object.values(index.attachments || {}).find(
          (record) => safeStr(record?.clientAttachmentId) === clientAttachmentId,
        );
        if (existing) {
          if (
            safeStr(existing?.contentSha256) &&
            safeStr(existing.contentSha256) !== contentSha256
          ) {
            const error = new Error(
              "clientAttachmentId cannot be reused for different attachment content",
            );
            error.code = "CLIENT_ATTACHMENT_ID_CONFLICT";
            throw error;
          }
          saved.push(existing);
          continue;
        }
      }

      const record = await saveAttachmentRecord({
        basePath,
        attachmentIndex: index,
        scope,
        name,
        mimeType: normalizedMime,
        contentBytes: bytes,
        isSandbox: resolveAttachmentIsSandbox(item),
        clientAttachmentId,
        contentSha256,
      });
      saved.push(record);
    }

    await writeAttachIndex(basePath, index, scope);
    return saved;
  });
}

export async function ingestGeneratedArtifacts(
  service,
  {
    userId,
    sessionId = "",
    attachmentSource = "model",
    artifacts = [],
    generationSource = "llm_output",
    owner = null,
    turnScope = null,
    turnScopeId = "",
    dialogProcessId = "",
  },
) {
  const basePath = resolveBasePath(service.globalConfig, userId);
  const list = Array.isArray(artifacts) ? artifacts : [];
  if (!list.length) return [];
  const entries = requireArtifactEntries(list, "artifacts");

  const scope = resolveAttachmentScope({ sessionId, attachmentSource, requireSessionId: true });
  return withAttachIndexLock(basePath, scope, async () => {
    const index = await readAttachIndex(basePath, scope);
    const saved = [];

    for (const { item, name: artifactName, contentBase64: artifactContent } of entries) {
      const record = await saveAttachmentRecord({
        basePath,
        attachmentIndex: index,
        scope,
        name: artifactName,
        mimeType: safeStr(item?.mimeType, DEFAULT_MIME_TYPE).toLowerCase(),
        contentBytes: Buffer.from(artifactContent, "base64"),
        generatedByModel: true,
        generationSource,
        owner:
          item?.owner && typeof item.owner === "object" && !Array.isArray(item.owner)
            ? item.owner
            : owner,
        turnScope:
          item?.turnScope && typeof item.turnScope === "object" && !Array.isArray(item.turnScope)
            ? item.turnScope
            : turnScope,
        turnScopeId: safeStr(item?.turnScopeId || turnScopeId),
        dialogProcessId: safeStr(
          item?.dialogProcessId || item?.dialog_process_id || dialogProcessId,
        ),
        isSandbox: resolveAttachmentIsSandbox(item, item?.meta),
      });
      saved.push(record);
    }

    await writeAttachIndex(basePath, index, scope);
    return saved;
  });
}

export async function ingestEmailArtifacts(
  service,
  { userId, sessionId = "", artifacts = [] } = {},
) {
  return ingestGeneratedArtifacts(service, {
    userId,
    sessionId,
    attachmentSource: "email",
    artifacts,
    generationSource: "email_connector_read",
  });
}
