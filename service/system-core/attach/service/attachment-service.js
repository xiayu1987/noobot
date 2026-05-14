/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

import { access, mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { Buffer } from "node:buffer";
import { v4 as uuidv4 } from "uuid";

import { DEFAULT_MIME_TYPE } from "../constants.js";
import { safeNum, safeStr } from "../../utils/shared-utils.js";
import { readAttachIndex, writeAttachIndex } from "../index-manager.js";
import { resolveAttachmentPolicy, isMimeTypeAllowed, isExtensionAllowed } from "../policy/policy-validator.js";
import { recoverableToolError } from "../../error/index.js";
import { tSystem } from "../../i18n/system-text.js";
import {
  attachScopeRoot,
  attachScopedRoot,
  findRecordAcrossScopedIndexes,
  resolveAttachmentScope,
  resolveBasePath,
} from "./path-resolver.js";
import { buildPublicRecord, normalizeExtension } from "./record-builder.js";

/**
 * 附件服务：对外暴露附件写入、读取、查询、删除 API。
 */
export class AttachmentService {
  /**
   * @param {object} globalConfig - 系统全局配置。
   */
  constructor(globalConfig) {
    this.globalConfig = globalConfig;
  }

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
    const extension = normalizeExtension(name, mimeType);
    const fileName = `${attachmentId}${extension}`;
    const savePath = path.join(attachScopeRoot(basePath, scope), fileName);

    await mkdir(path.dirname(savePath), { recursive: true });
    await writeFile(savePath, contentBytes);

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
    });

    attachmentIndex.attachments[attachmentId] = record;
    return record;
  }

  /**
   * 持久化用户上传附件。
   *
   * @param {object} params - 入参。
   * @param {string} params.userId - 用户 ID。
   * @param {string} [params.sessionId] - 会话 ID。
   * @param {string} [params.attachmentSource] - 附件来源。
   * @param {Array<{name: string, contentBase64: string, mimeType?: string}>} params.attachments - 附件列表。
   * @param {object} [params.attachmentPolicy] - 附件策略。
   * @returns {Promise<object[]>}
   */
  async ingest({ userId, sessionId = "", attachmentSource = "user", attachments, attachmentPolicy = {} }) {
    const basePath = resolveBasePath(this.globalConfig, userId);
    if (!attachments?.length) return [];

    const scope = resolveAttachmentScope({ sessionId, attachmentSource, requireSessionId: true });
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

  /**
   * 持久化模型生成的产物。
   *
   * @param {object} params - 入参。
   * @param {string} params.userId - 用户 ID。
   * @param {string} [params.sessionId] - 会话 ID。
   * @param {string} [params.attachmentSource] - 附件来源。
   * @param {Array<{name: string, contentBase64: string, mimeType?: string}>} [params.artifacts] - 产物列表。
   * @param {string} [params.generationSource] - 生成来源。
   * @returns {Promise<object[]>}
   */
  async ingestGeneratedArtifacts({
    userId,
    sessionId = "",
    attachmentSource = "model",
    artifacts = [],
    generationSource = "llm_output",
  }) {
    const basePath = resolveBasePath(this.globalConfig, userId);
    const list = Array.isArray(artifacts) ? artifacts : [];
    if (!list.length) return [];

    const scope = resolveAttachmentScope({ sessionId, attachmentSource, requireSessionId: true });
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

  /**
   * 持久化邮件连接器产物。
   *
   * @param {object} [params] - 入参。
   * @param {string} params.userId - 用户 ID。
   * @param {string} [params.sessionId] - 会话 ID。
   * @param {Array<{name: string, contentBase64: string, mimeType?: string}>} [params.artifacts] - 邮件附件列表。
   * @returns {Promise<object[]>}
   */
  async ingestEmailArtifacts({ userId, sessionId = "", artifacts = [] } = {}) {
    return this.ingestGeneratedArtifacts({
      userId,
      sessionId,
      attachmentSource: "email",
      artifacts,
      generationSource: "email_connector_read",
    });
  }

  /**
   * 按附件 ID 查询附件元数据与绝对路径。
   *
   * @param {object} params - 入参。
   * @param {string} params.userId - 用户 ID。
   * @param {string} params.attachmentId - 附件 ID。
   * @param {string} [params.sessionId] - 会话 ID（可选）。
   * @param {string} [params.attachmentSource] - 附件来源（可选）。
   * @returns {Promise<object|null>}
   */
  async getAttachmentById({ userId, attachmentId, sessionId = "", attachmentSource = "" }) {
    const id = safeStr(attachmentId);
    if (!id) return null;

    const basePath = resolveBasePath(this.globalConfig, userId);
    const scope = resolveAttachmentScope({ sessionId, attachmentSource });
    const hasExplicitScope = safeStr(sessionId) || safeStr(attachmentSource);

    const record = hasExplicitScope
      ? (await readAttachIndex(basePath, scope))?.attachments?.[id] || null
      : await findRecordAcrossScopedIndexes(basePath, id);

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
      ...buildPublicRecord(basePath, record),
      absolutePath: resolvedPath,
      size: safeNum(fileStat?.size, record.size || 0),
    };
  }

  /**
   * 读取某个 scope 下的附件元数据列表。
   *
   * @param {object} [params] - 入参。
   * @param {string} params.userId - 用户 ID。
   * @param {string} [params.sessionId] - 会话 ID。
   * @param {string} [params.attachmentSource] - 附件来源。
   * @returns {Promise<object[]>}
   */
  async readAttachmentMetas({ userId, sessionId = "", attachmentSource = "" } = {}) {
    const basePath = resolveBasePath(this.globalConfig, userId);
    const scope = resolveAttachmentScope({ sessionId, attachmentSource });
    const index = await readAttachIndex(basePath, scope);
    const records = Object.values(index?.attachments || {});
    return records.map((r) => buildPublicRecord(basePath, r));
  }

  /**
   * 读取附件内容。
   *
   * @param {object} params - 入参。
   * @param {string} params.userId - 用户 ID。
   * @param {string} params.attachmentId - 附件 ID。
   * @returns {Promise<object|null>}
   */
  async readAttachmentContent({ userId, attachmentId }) {
    const record = await this.getAttachmentById({ userId, attachmentId });
    if (!record) return null;
    return { ...record, content: await readFile(record.absolutePath) };
  }

  /**
   * 批量删除指定会话的 scoped 附件目录。
   *
   * @param {object} [params] - 入参。
   * @param {string} params.userId - 用户 ID。
   * @param {string[]} [params.sessionIds] - 待删除的会话 ID 列表。
   * @returns {Promise<{deletedSessionIds: string[], deletedCount: number}>}
   */
  async deleteScopedAttachmentsBySessionIds({ userId, sessionIds = [] } = {}) {
    const basePath = resolveBasePath(this.globalConfig, userId);
    const scopedRoot = attachScopedRoot(basePath);

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
