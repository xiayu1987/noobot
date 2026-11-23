/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

import {
  ingestAttachments,
  ingestGeneratedArtifacts,
  ingestEmailArtifacts,
} from "./attachment-service-ingest.js";
import { linkParsedResultToAttachment } from "./attachment-service-link.js";
import { deleteScopedAttachmentsBySessionIds } from "./attachment-service-cleanup.js";
import {
  getAttachmentById,
  openAttachmentStream,
  readAttachmentContent,
  readAttachmentMetadata,
  readAttachmentMetas,
} from "./attachment-service-query.js";

export class AttachmentService {
  constructor(globalConfig) {
    this.globalConfig = globalConfig;
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

  async getAttachmentById({ userId, attachmentId, sessionId = "", attachmentSource = "" }) {
    return getAttachmentById(this, { userId, attachmentId, sessionId, attachmentSource });
  }

  async openAttachmentStream(payload = {}) {
    return openAttachmentStream(this, payload);
  }

  async readAttachmentMetadata(request) {
    return readAttachmentMetadata(this, request);
  }

  async readAttachmentMetas({ userId, sessionId = "", attachmentSource = "" } = {}) {
    return readAttachmentMetas(this, { userId, sessionId, attachmentSource });
  }

  async readAttachmentContent({ userId, attachmentId, sessionId = "", attachmentSource = "" }) {
    return readAttachmentContent(this, {
      userId,
      attachmentId,
      sessionId,
      attachmentSource,
    });
  }

  async deleteScopedAttachmentsBySessionIds({ userId, sessionIds = [] } = {}) {
    return deleteScopedAttachmentsBySessionIds(this, { userId, sessionIds });
  }
}
