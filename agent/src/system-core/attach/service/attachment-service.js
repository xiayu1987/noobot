/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

import {
  ingestAttachments,
  ingestGeneratedArtifacts,
  ingestEmailArtifacts,
  saveAttachmentRecord,
} from "./attachment-service-ingest.js";
import {
  buildLinkParsedScopeCandidates,
  collectSessionJsonFiles,
  isAttachmentPathMatch,
  linkParsedResultInScopes,
  linkParsedResultToAttachment,
  syncParsedResultToSessionSnapshots,
  walkSessionJsonFilesFromRoot,
} from "./attachment-service-link.js";
import {
  deleteScopedAttachmentsBySessionIds,
  pruneOrphanScopedAttachments,
} from "./attachment-service-cleanup.js";
import {
  getAttachmentById,
  readAttachmentContent,
  readAttachmentMetas,
  resolveSourceAttachment,
} from "./attachment-service-query.js";

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

  async _saveAttachmentRecord(payload = {}) {
    return saveAttachmentRecord(payload);
  }

  async ingest(payload = {}) {
    return ingestAttachments(this, payload);
  }

  async ingestGeneratedArtifacts(payload = {}) {
    return ingestGeneratedArtifacts(this, payload);
  }

  async ingestEmailArtifacts(payload = {}) {
    return ingestEmailArtifacts(this, payload);
  }

  async linkParsedResultToAttachment(payload = {}) {
    return linkParsedResultToAttachment(this, payload);
  }

  async _buildLinkParsedScopeCandidates(payload = {}) {
    return buildLinkParsedScopeCandidates(payload);
  }

  async _linkParsedResultInScopes(payload = {}) {
    return linkParsedResultInScopes(payload);
  }

  _isAttachmentPathMatch(payload = {}) {
    return isAttachmentPathMatch(payload);
  }

  async _syncParsedResultToSessionSnapshots(payload = {}) {
    return syncParsedResultToSessionSnapshots(payload);
  }

  async _collectSessionJsonFiles(payload = {}) {
    return collectSessionJsonFiles(payload);
  }

  async _walkSessionJsonFilesFromRoot(payload = {}) {
    return walkSessionJsonFilesFromRoot(payload);
  }

  /**
   * 按附件 ID 查询附件元数据与绝对路径。
   */
  async getAttachmentById({ userId, attachmentId, sessionId = "", attachmentSource = "" }) {
    return getAttachmentById(this, { userId, attachmentId, sessionId, attachmentSource });
  }

  /**
   * 读取某个 scope 下的附件元数据列表。
   */
  async readAttachmentMetas({ userId, sessionId = "", attachmentSource = "" } = {}) {
    return readAttachmentMetas(this, { userId, sessionId, attachmentSource });
  }

  async resolveSourceAttachment(payload = {}) {
    return resolveSourceAttachment(this, payload);
  }

  /**
   * 读取附件内容。
   */
  async readAttachmentContent({ userId, attachmentId }) {
    return readAttachmentContent(this, { userId, attachmentId });
  }

  /**
   * 批量删除指定会话的 scoped 附件目录。
   */
  async deleteScopedAttachmentsBySessionIds({ userId, sessionIds = [] } = {}) {
    return deleteScopedAttachmentsBySessionIds(this, { userId, sessionIds });
  }

  /**
   * 清理已不存在会话的 scoped 附件目录（孤儿目录）。
   */
  async pruneOrphanScopedAttachments({
    userId,
    keepSessionIds = [],
    attachmentSources = [],
  } = {}) {
    return pruneOrphanScopedAttachments(this, { userId, keepSessionIds, attachmentSources });
  }
}
