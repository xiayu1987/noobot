/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

import { access, mkdir, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { Buffer } from "node:buffer";
import { v4 as uuidv4 } from "uuid";

import {
  DEFAULT_ATTACHMENT_SESSION_ID,
  DEFAULT_ATTACHMENT_SOURCE,
  ATTACHMENT_SOURCES,
  DEFAULT_MIME_TYPE,
  MIME_TO_EXTENSION,
  MAX_EXTENSION_LENGTH,
} from "./constants.js";
import { safeStr, safeNum } from "./utils.js";
import { readAttachIndex, writeAttachIndex } from "./index-manager.js";
import {
  resolveAttachmentPolicy,
  isMimeTypeAllowed,
  isExtensionAllowed,
} from "./policy-validator.js";
import { fatalSystemError, recoverableToolError } from "../error/index.js";
import { tSystem } from "../i18n/system-text.js";

export class AttachmentService {
  constructor(globalConfig) {
    this.globalConfig = globalConfig;
  }

  // ── 路径解析 ──

  _resolveBasePath(userId) {
    const uid = safeStr(userId);
    const root = safeStr(this.globalConfig?.workspaceRoot);
    if (!uid || !root) {
      throw fatalSystemError(tSystem("common.workspaceRootUserIdRequired"), {
        code: "FATAL_WORKSPACE_PATH_INVALID",
      });
    }
    return path.resolve(root, uid);
  }

  _resolveAttachmentScope({ sessionId = "", attachmentSource = "", requireSessionId = false } = {}) {
    const normalizedSessionId = safeStr(sessionId) === DEFAULT_ATTACHMENT_SESSION_ID ? "" : safeStr(sessionId);
    if (requireSessionId && !normalizedSessionId) {
      throw recoverableToolError(tSystem("attach.sessionIdRequiredForPersistence"), {
        code: "RECOVERABLE_ATTACHMENT_SESSION_ID_REQUIRED",
        details: { hint: tSystem("attach.sessionIdPersistenceHint") },
      });
    }
    return {
      sessionId: normalizedSessionId || DEFAULT_ATTACHMENT_SESSION_ID,
      attachmentSource: this._normalizeSource(attachmentSource),
    };
  }

  _normalizeSource(source) {
    const normalized = safeStr(source).toLowerCase();
    return ATTACHMENT_SOURCES.has(normalized) ? normalized : DEFAULT_ATTACHMENT_SOURCE;
  }

  _attachScopedRoot(basePath) {
    return path.join(basePath, "runtime/attach/scoped");
  }

  _attachScopeRoot(basePath, scope) {
    return path.join(this._attachScopedRoot(basePath), scope.sessionId, scope.attachmentSource);
  }

  // ── 附件记录构建 ──

  _normalizeRelativePath(basePath, absolutePath) {
    return path.relative(basePath, absolutePath).split(path.sep).join(path.posix.sep);
  }

  _buildPublicRecord(basePath, record) {
    return {
      attachmentId: safeStr(record.attachmentId),
      name: safeStr(record.name),
      mimeType: safeStr(record.mimeType, DEFAULT_MIME_TYPE),
      size: safeNum(record.size),
      path: safeStr(record.path),
      relativePath:
        safeStr(record.relativePath) || this._normalizeRelativePath(basePath, safeStr(record.path)),
      createdAt: safeStr(record.createdAt, new Date().toISOString()),
      sessionId: safeStr(record.sessionId, DEFAULT_ATTACHMENT_SESSION_ID),
      attachmentSource: safeStr(record.attachmentSource, DEFAULT_ATTACHMENT_SOURCE),
      generatedByModel: record?.generatedByModel === true,
      generationSource: safeStr(record.generationSource),
    };
  }

  _normalizeExtension(fileName, mimeType) {
    const fromName = path.extname(safeStr(fileName)).slice(0, MAX_EXTENSION_LENGTH);
    if (fromName) return fromName;
    return (MIME_TO_EXTENSION[safeStr(mimeType).toLowerCase()] || "").slice(0, MAX_EXTENSION_LENGTH);
  }

  // ── 保存附件 ──

  async _saveAttachmentRecord({
    basePath,
    attachmentIndex,
    scope,
    name,
    mimeType = DEFAULT_MIME_TYPE,
    contentBytes = Buffer.alloc(0),
    generatedByModel = false,
    generationSource = "",
  }) {
    const attachmentId = uuidv4();
    const extension = this._normalizeExtension(name, mimeType);
    const fileName = `${attachmentId}${extension}`;
    const savePath = path.join(this._attachScopeRoot(basePath, scope), fileName);

    await mkdir(path.dirname(savePath), { recursive: true });
    await writeFile(savePath, contentBytes);

    const record = this._buildPublicRecord(basePath, {
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
    });

    attachmentIndex.attachments[attachmentId] = record;
    return record;
  }

  // ── 跨范围查找 ──

  async _findRecordAcrossScopedIndexes(basePath, attachmentId) {
    const id = safeStr(attachmentId);
    if (!id) return null;

    const scopedRoot = this._attachScopedRoot(basePath);
    let sessionEntries;
    try {
      sessionEntries = await readdir(scopedRoot, { withFileTypes: true });
    } catch {
      return null;
    }

    for (const sessionEntry of sessionEntries) {
      if (!sessionEntry?.isDirectory?.()) continue;
      const sessionRoot = path.join(scopedRoot, sessionEntry.name);
      let sourceEntries;
      try {
        sourceEntries = await readdir(sessionRoot, { withFileTypes: true });
      } catch {
        continue;
      }

      for (const sourceEntry of sourceEntries) {
        if (!sourceEntry?.isDirectory?.()) continue;
        const index = await readAttachIndex(basePath, {
          sessionId: sessionEntry.name,
          attachmentSource: sourceEntry.name,
        });
        const hit = index?.attachments?.[id];
        if (hit) return hit;
      }
    }
    return null;
  }

  // ── 公共 API ──

  async ingest({ userId, sessionId = "", attachmentSource = "user", attachments, attachmentPolicy = {} }) {
    const basePath = this._resolveBasePath(userId);
    if (!attachments?.length) return [];

    const scope = this._resolveAttachmentScope({ sessionId, attachmentSource, requireSessionId: true });
    const policy = resolveAttachmentPolicy(attachmentPolicy);

    if (policy.maxFileCount > 0 && attachments.length > policy.maxFileCount) {
      throw recoverableToolError(
        `${tSystem("attach.countExceedsLimit")}: ${attachments.length} > ${policy.maxFileCount}`,
        {
          code: "RECOVERABLE_ATTACHMENT_COUNT_LIMIT_EXCEEDED",
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
          code: "RECOVERABLE_ATTACHMENT_MIME_TYPE_NOT_ALLOWED",
          details: { mimeType: normalizedMime },
        });
      }

      if (!isExtensionAllowed(safeStr(name), policy.allowedExtensions)) {
        throw recoverableToolError(`${tSystem("attach.extensionNotAllowed")}: ${safeStr(name)}`, {
          code: "RECOVERABLE_ATTACHMENT_EXTENSION_NOT_ALLOWED",
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
            code: "RECOVERABLE_ATTACHMENT_FILE_SIZE_LIMIT_EXCEEDED",
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
            code: "RECOVERABLE_ATTACHMENT_TOTAL_SIZE_LIMIT_EXCEEDED",
            details: {
              totalSizeBytes: totalBytes,
              maxTotalSizeBytes: policy.maxTotalSizeBytes,
              hint: tSystem("attach.hintIncreaseMaxTotalSizeOrReduceUpload"),
            },
          },
        );
      }

      const record = await this._saveAttachmentRecord({
        basePath,
        attachmentIndex: index,
        scope,
        name,
        mimeType: normalizedMime,
        contentBytes: bytes,
      });
      saved.push(record);
    }

    await writeAttachIndex(basePath, index, scope);
    return saved;
  }

  async ingestGeneratedArtifacts({
    userId,
    sessionId = "",
    attachmentSource = "model",
    artifacts = [],
    generationSource = "llm_output",
  }) {
    const basePath = this._resolveBasePath(userId);
    const list = Array.isArray(artifacts) ? artifacts : [];
    if (!list.length) return [];

    const scope = this._resolveAttachmentScope({ sessionId, attachmentSource, requireSessionId: true });
    const index = await readAttachIndex(basePath, scope);
    const saved = [];

    for (const item of list) {
      const artifactName = safeStr(item?.name);
      const artifactContent = safeStr(item?.contentBase64);
      if (!artifactName || !artifactContent) continue;

      const record = await this._saveAttachmentRecord({
        basePath,
        attachmentIndex: index,
        scope,
        name: artifactName,
        mimeType: safeStr(item?.mimeType, DEFAULT_MIME_TYPE).toLowerCase(),
        contentBytes: Buffer.from(artifactContent, "base64"),
        generatedByModel: true,
        generationSource,
      });
      saved.push(record);
    }

    await writeAttachIndex(basePath, index, scope);
    return saved;
  }

  async ingestEmailArtifacts({ userId, sessionId = "", artifacts = [] } = {}) {
    return this.ingestGeneratedArtifacts({
      userId,
      sessionId,
      attachmentSource: "email",
      artifacts,
      generationSource: "email_connector_read",
    });
  }

  async getAttachmentById({ userId, attachmentId, sessionId = "", attachmentSource = "" }) {
    const id = safeStr(attachmentId);
    if (!id) return null;

    const basePath = this._resolveBasePath(userId);
    const scope = this._resolveAttachmentScope({ sessionId, attachmentSource });
    const hasExplicitScope = safeStr(sessionId) || safeStr(attachmentSource);

    let record = hasExplicitScope
      ? (await readAttachIndex(basePath, scope))?.attachments?.[id] || null
      : await this._findRecordAcrossScopedIndexes(basePath, id);

    if (!record) return null;

    const resolvedPath = safeStr(record.path);
    if (!resolvedPath) return null;

    try {
      await access(resolvedPath);
    } catch {
      return null;
    }

    const fileStat = await stat(resolvedPath);
    return {
      ...this._buildPublicRecord(basePath, record),
      absolutePath: resolvedPath,
      size: safeNum(fileStat?.size, record.size || 0),
    };
  }

  async readAttachmentMetas({ userId, sessionId = "", attachmentSource = "" } = {}) {
    const basePath = this._resolveBasePath(userId);
    const scope = this._resolveAttachmentScope({ sessionId, attachmentSource });
    const index = await readAttachIndex(basePath, scope);
    const records = Object.values(index?.attachments || {});
    return records.map((r) => this._buildPublicRecord(basePath, r));
  }

  async readAttachmentContent({ userId, attachmentId }) {
    const record = await this.getAttachmentById({ userId, attachmentId });
    if (!record) return null;
    return { ...record, content: await readFile(record.absolutePath) };
  }

  async deleteScopedAttachmentsBySessionIds({ userId, sessionIds = [] } = {}) {
    const basePath = this._resolveBasePath(userId);
    const scopedRoot = this._attachScopedRoot(basePath);

    const normalizedIds = [
      ...new Set(
        (Array.isArray(sessionIds) ? sessionIds : [])
          .map((s) => safeStr(s))
          .filter(Boolean),
      ),
    ];

    if (!normalizedIds.length) return { deletedSessionIds: [], deletedCount: 0 };

    const deleted = [];
    for (const sid of normalizedIds) {
      try {
        await rm(path.join(scopedRoot, sid), { recursive: true, force: true });
        deleted.push(sid);
      } catch {
        // ignore per-session delete error
      }
    }

    return { deletedSessionIds: deleted, deletedCount: deleted.length };
  }
}
