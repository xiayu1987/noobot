/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import {
  writeFileSync,
  readFileSync,
  existsSync,
  mkdirSync,
  statSync,
} from "node:fs";
import path from "node:path";
import { Buffer } from "node:buffer";
import { v4 as uuidv4 } from "uuid";
import { readJsonFile } from "../utils/json.js";

export class AttachmentService {
  constructor(globalConfig) {
    this.globalConfig = globalConfig;
  }

  _resolveBasePath(userId = "") {
    const normalizedUserId = String(userId || "").trim();
    const workspaceRoot = String(this.globalConfig?.workspaceRoot || "").trim();
    if (!normalizedUserId || !workspaceRoot) {
      throw new Error("workspaceRoot/userId required");
    }
    return path.resolve(workspaceRoot, normalizedUserId);
  }

  _attachRoot(basePath) {
    return path.join(basePath, "runtime/attach");
  }

  _attachIndexFile(basePath) {
    return path.join(this._attachRoot(basePath), "attachments.json");
  }

  _ensureAttachDirs(basePath) {
    mkdirSync(this._attachRoot(basePath), { recursive: true });
  }

  _readAttachIndex(basePath) {
    this._ensureAttachDirs(basePath);
    const indexFile = this._attachIndexFile(basePath);
    return readJsonFile(indexFile, {
      updatedAt: new Date().toISOString(),
      attachments: {},
    });
  }

  _writeAttachIndex(basePath, indexData = {}) {
    this._ensureAttachDirs(basePath);
    const indexFile = this._attachIndexFile(basePath);
    const payload = {
      updatedAt: new Date().toISOString(),
      attachments:
        indexData?.attachments && typeof indexData.attachments === "object"
          ? indexData.attachments
          : {},
    };
    writeFileSync(indexFile, JSON.stringify(payload, null, 2), "utf8");
  }

  _normalizeRelativePath(basePath, absolutePath) {
    return path
      .relative(basePath, absolutePath)
      .split(path.sep)
      .join(path.posix.sep);
  }

  _buildAttachmentPublicRecord(basePath, attachmentRecord = {}) {
    return {
      attachmentId: String(attachmentRecord.attachmentId || ""),
      name: String(attachmentRecord.name || ""),
      mimeType: String(attachmentRecord.mimeType || "application/octet-stream"),
      size: Number(attachmentRecord.size || 0),
      path: String(attachmentRecord.path || ""),
      relativePath:
        String(attachmentRecord.relativePath || "") ||
        this._normalizeRelativePath(basePath, String(attachmentRecord.path || "")),
      createdAt: String(attachmentRecord.createdAt || new Date().toISOString()),
    };
  }

  async ingest({ userId, attachments }) {
    const basePath = this._resolveBasePath(userId);
    if (!attachments?.length) return [];
    const attachmentIndex = this._readAttachIndex(basePath);
    const savedAttachmentRecords = [];

    for (const item of attachments) {
      const { name, contentBase64, mimeType = "application/octet-stream" } = item;
      if (!name || !contentBase64) continue;
      const bytes = Buffer.from(contentBase64, "base64");
      const attachmentId = uuidv4();
      const extension = path.extname(String(name || "")).slice(0, 20);
      const fileName = `${attachmentId}${extension}`;
      const savePath = path.join(this._attachRoot(basePath), fileName);
      const now = new Date().toISOString();
      writeFileSync(savePath, bytes);
      const attachmentRecord = this._buildAttachmentPublicRecord(basePath, {
        attachmentId,
        name,
        mimeType,
        size: bytes.length,
        path: savePath,
        createdAt: now,
      });
      attachmentIndex.attachments[attachmentId] = attachmentRecord;
      savedAttachmentRecords.push(attachmentRecord);
    }

    this._writeAttachIndex(basePath, attachmentIndex);
    return savedAttachmentRecords;
  }

  getAttachmentById({ userId, attachmentId }) {
    const normalizedAttachmentId = String(attachmentId || "").trim();
    if (!normalizedAttachmentId) return null;
    const basePath = this._resolveBasePath(userId);
    const attachmentIndex = this._readAttachIndex(basePath);
    const record = attachmentIndex?.attachments?.[normalizedAttachmentId];
    if (!record) return null;

    const resolvedPath = String(record.path || "");
    if (!resolvedPath || !existsSync(resolvedPath)) return null;

    const fileStat = statSync(resolvedPath);
    return {
      ...this._buildAttachmentPublicRecord(basePath, record),
      absolutePath: resolvedPath,
      size: Number(fileStat.size || record.size || 0),
    };
  }

  readAttachmentContent({ userId, attachmentId }) {
    const record = this.getAttachmentById({ userId, attachmentId });
    if (!record) return null;
    return {
      ...record,
      content: readFileSync(record.absolutePath),
    };
  }
}
