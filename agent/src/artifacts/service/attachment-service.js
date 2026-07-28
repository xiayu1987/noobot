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

export class AttachmentService {
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

  async getAttachmentById({ userId, attachmentId, sessionId = "", attachmentSource = "" }) {
    return getAttachmentById(this, { userId, attachmentId, sessionId, attachmentSource });
  }

  async readAttachmentMetas({ userId, sessionId = "", attachmentSource = "" } = {}) {
    return readAttachmentMetas(this, { userId, sessionId, attachmentSource });
  }

  async resolveSourceAttachment(payload = {}) {
    return resolveSourceAttachment(this, payload);
  }

  async readAttachmentContent({ userId, attachmentId }) {
    return readAttachmentContent(this, { userId, attachmentId });
  }

  async deleteScopedAttachmentsBySessionIds({ userId, sessionIds = [] } = {}) {
    return deleteScopedAttachmentsBySessionIds(this, { userId, sessionIds });
  }

  async pruneOrphanScopedAttachments({
    userId,
    keepSessionIds = [],
    attachmentSources = [],
  } = {}) {
    return pruneOrphanScopedAttachments(this, { userId, keepSessionIds, attachmentSources });
  }
}
