/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

import { isPlainObject } from "@noobot/shared/value";
import { filePath as path } from "@noobot/path-resolver";
import { Buffer } from "node:buffer";
import { createHash } from "node:crypto";
import { v4 as uuidv4 } from "uuid";
import {
  ATTACHMENT_SOURCE,
  assertAttachmentIngestInputs,
  assertAttachmentIngestResult,
} from "@noobot/attachment-protocol";
import { resolveAttachmentPolicy } from "@noobot/agent-config-protocol";

import { DEFAULT_MIME_TYPE } from "../constants.js";
import { safeStr } from "../../shared/utils/shared-utils.js";
import { withAttachmentSessionWrite } from "../index-manager.js";
import { isMimeTypeAllowed, isExtensionAllowed } from "../policy/policy-validator.js";
import { recoverableToolError } from "../../shared/errors/index.js";
import { tSystem } from "noobot-i18n/agent/system-text";
import { resolveBasePath, resolveAttachmentScope } from "./attachment-scope-resolver.js";
import { attachScopeRoot } from "./attachment-storage-layout.js";
import { buildPublicRecord, normalizeExtension } from "./record-builder.js";
import { ERROR_CODE } from "../../shared/errors/constants.js";

function requireArtifactEntries(items, label) {
  return items.map((item, index) => {
    if (!isPlainObject(item)) {
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

function prepareAttachment({
  basePath,
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
  clientAttachmentId = "",
  contentSha256 = "",
  origin,
}) {
  const attachmentId = uuidv4();
  const extension = normalizeExtension(name, mimeType);
  const fileName = `${attachmentId}${extension}`;
  const savePath = path.join(attachScopeRoot(basePath, scope), fileName);

  const createdAt = new Date().toISOString();
  const record = buildPublicRecord(basePath, {
    attachmentId,
    clientAttachmentId,
    contentSha256,
    name: safeStr(name),
    mimeType: safeStr(mimeType, DEFAULT_MIME_TYPE),
    size: contentBytes.length,
    path: savePath,
    createdAt,
    updatedAt: createdAt,
    relations: [],
    sessionId: scope.sessionId,
    attachmentSource: scope.attachmentSource,
    generatedByModel,
    generationSource,
    owner,
    turnScope,
    turnScopeId,
    dialogProcessId,
    origin,
  });

  return { record, contentBytes };
}

function assertReusableContent(existing, contentSha256) {
  if (safeStr(existing.contentSha256) && safeStr(existing.contentSha256) !== contentSha256) {
    const error = new Error("clientAttachmentId cannot be reused for different attachment content");
    error.code = "CLIENT_ATTACHMENT_ID_CONFLICT";
    throw error;
  }
}

export async function ingestAttachments(
  service,
  { userId, sessionId = "", attachmentSource = "user", attachments },
) {
  const basePath = resolveBasePath(service.globalConfig, userId);
  assertAttachmentIngestInputs(attachments);
  if (!attachments.length) return [];

  const scope = resolveAttachmentScope({ sessionId, attachmentSource });
  const policy = resolveAttachmentPolicy(service.globalConfig);
  const entries = requireArtifactEntries(attachments, "attachments");

  if (attachments.length > policy.maxFileCount) {
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
    if (bytes.length > policy.maxFileSizeBytes) {
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
  if (totalBytes > policy.maxTotalSizeBytes) {
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

  return withAttachmentSessionWrite({ basePath, userId, scope }, async (catalog) => {
    const byClientId = new Map();
    const newEntries = [];
    const saved = [];

    for (const { item, name, normalizedMime, bytes } of prepared) {
      const clientAttachmentId = safeStr(item?.clientAttachmentId);
      const contentSha256 = createHash("sha256").update(bytes).digest("hex");
      const existing = clientAttachmentId
        ? (byClientId.get(clientAttachmentId) ?? catalog.readClient(clientAttachmentId))
        : null;
      if (existing) {
        assertReusableContent(existing, contentSha256);
        saved.push(existing);
        continue;
      }

      const entry = prepareAttachment({
        basePath,
        scope,
        name,
        mimeType: normalizedMime,
        contentBytes: bytes,
        clientAttachmentId,
        contentSha256,
      });
      newEntries.push(entry);
      if (clientAttachmentId) byClientId.set(clientAttachmentId, entry.record);
      saved.push(entry.record);
    }

    assertAttachmentIngestResult(attachments, saved);
    await catalog.publish(newEntries);
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
  const list = assertAttachmentIngestInputs(artifacts);
  if (!list.length) return [];
  const entries = requireArtifactEntries(list, "artifacts");

  const scope = resolveAttachmentScope({ sessionId, attachmentSource });
  return withAttachmentSessionWrite({ basePath, userId, scope }, async (catalog) => {
    const newEntries = entries.map(({ item, name: artifactName, contentBase64: artifactContent }) =>
      prepareAttachment({
        basePath,
        scope,
        name: artifactName,
        mimeType: safeStr(item.mimeType, DEFAULT_MIME_TYPE).toLowerCase(),
        contentBytes: Buffer.from(artifactContent, "base64"),
        generatedByModel: true,
        generationSource,
        owner: isPlainObject(item.owner) ? item.owner : owner,
        turnScope: isPlainObject(item.turnScope) ? item.turnScope : turnScope,
        turnScopeId: safeStr(item.turnScopeId || turnScopeId),
        dialogProcessId: safeStr(item.dialogProcessId || dialogProcessId),
        origin: item.origin,
      }),
    );
    const records = newEntries.map(({ record }) => record);
    assertAttachmentIngestResult(list, records);
    await catalog.publish(newEntries);
    return records;
  });
}

export async function ingestEmailArtifacts(
  service,
  { userId, sessionId = "", artifacts = [] } = {},
) {
  return ingestGeneratedArtifacts(service, {
    userId,
    sessionId,
    attachmentSource: ATTACHMENT_SOURCE.EMAIL,
    artifacts,
    generationSource: "email_connector_read",
  });
}
