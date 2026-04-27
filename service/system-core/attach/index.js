/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { access, mkdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { Buffer } from "node:buffer";
import { v4 as uuidv4 } from "uuid";
import { fatalSystemError, recoverableToolError } from "../error/index.js";

export function mergeAttachmentMetas(existingAttachmentMetas = [], incomingAttachmentMetas = []) {
  const existingList = Array.isArray(existingAttachmentMetas)
    ? existingAttachmentMetas
    : [];
  const incomingList = Array.isArray(incomingAttachmentMetas)
    ? incomingAttachmentMetas
    : [];
  if (!incomingList.length) return existingList;
  const mergedList = [...existingList];
  const existingAttachmentIdSet = new Set(
    existingList
      .map((attachmentItem) => String(attachmentItem?.attachmentId || "").trim())
      .filter(Boolean),
  );
  for (const attachmentItem of incomingList) {
    const attachmentId = String(attachmentItem?.attachmentId || "").trim();
    if (attachmentId && existingAttachmentIdSet.has(attachmentId)) continue;
    mergedList.push(attachmentItem);
    if (attachmentId) existingAttachmentIdSet.add(attachmentId);
  }
  return mergedList;
}

export function mapAttachmentRecordsToMetas(
  attachmentRecords = [],
  { fallbackMimeType = "application/octet-stream", fallbackGenerationSource = "" } = {},
) {
  const recordList = Array.isArray(attachmentRecords) ? attachmentRecords : [];
  return recordList.map((attachmentItem) => ({
    attachmentId: String(attachmentItem?.attachmentId || "").trim(),
    name: String(attachmentItem?.name || "").trim(),
    mimeType: String(attachmentItem?.mimeType || fallbackMimeType).trim(),
    size: Number(attachmentItem?.size || 0),
    generatedByModel: attachmentItem?.generatedByModel === true,
    generationSource: String(
      attachmentItem?.generationSource || fallbackGenerationSource || "",
    ).trim(),
  }));
}

export function appendAttachmentMetasToRuntimeAndTurn({
  runtime = {},
  turnMessageStore = null,
  attachmentMetas = [],
} = {}) {
  const normalizedAttachmentMetas = Array.isArray(attachmentMetas)
    ? attachmentMetas
    : [];
  if (!normalizedAttachmentMetas.length) return;

  if (!Array.isArray(runtime.attachmentMetas)) {
    runtime.attachmentMetas = [];
  }
  runtime.attachmentMetas = mergeAttachmentMetas(
    runtime.attachmentMetas,
    normalizedAttachmentMetas,
  );

  if (!turnMessageStore || typeof turnMessageStore.updateLast !== "function") {
    return;
  }
  let latestAssistantMessage = null;
  turnMessageStore.updateLast(
    {},
    (messageItem) => {
      if (String(messageItem?.role || "").trim() !== "assistant") return false;
      latestAssistantMessage = messageItem;
      return true;
    },
  );
  const mergedAttachmentMetas = mergeAttachmentMetas(
    latestAssistantMessage?.attachmentMetas || [],
    normalizedAttachmentMetas,
  );
  turnMessageStore.updateLast(
    { attachmentMetas: mergedAttachmentMetas },
    (messageItem) => String(messageItem?.role || "").trim() === "assistant",
  );
}

export class AttachmentService {
  constructor(globalConfig) {
    this.globalConfig = globalConfig;
  }

  _resolveBasePath(userId = "") {
    const normalizedUserId = String(userId || "").trim();
    const workspaceRoot = String(this.globalConfig?.workspaceRoot || "").trim();
    if (!normalizedUserId || !workspaceRoot) {
      throw fatalSystemError("workspaceRoot/userId required", {
        code: "FATAL_WORKSPACE_PATH_INVALID",
      });
    }
    return path.resolve(workspaceRoot, normalizedUserId);
  }

  _attachRoot(basePath) {
    return path.join(basePath, "runtime/attach");
  }

  _attachIndexFile(basePath) {
    return path.join(this._attachRoot(basePath), "attachments.json");
  }

  async _ensureAttachDirs(basePath) {
    await mkdir(this._attachRoot(basePath), { recursive: true });
  }

  async _readAttachIndex(basePath) {
    await this._ensureAttachDirs(basePath);
    const indexFile = this._attachIndexFile(basePath);
    try {
      const raw = await readFile(indexFile, "utf8");
      const parsed = JSON.parse(raw);
      const attachments =
        parsed?.attachments && typeof parsed.attachments === "object"
          ? parsed.attachments
          : {};
      return {
        updatedAt: String(parsed?.updatedAt || new Date().toISOString()),
        attachments,
      };
    } catch {
      return {
      updatedAt: new Date().toISOString(),
      attachments: {},
      };
    }
  }

  async _writeAttachIndex(basePath, indexData = {}) {
    await this._ensureAttachDirs(basePath);
    const indexFile = this._attachIndexFile(basePath);
    const payload = {
      updatedAt: new Date().toISOString(),
      attachments:
        indexData?.attachments && typeof indexData.attachments === "object"
          ? indexData.attachments
          : {},
    };
    await writeFile(indexFile, JSON.stringify(payload, null, 2), "utf8");
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
      generatedByModel: attachmentRecord?.generatedByModel === true,
      generationSource: String(attachmentRecord?.generationSource || ""),
    };
  }

  _mimeTypeToExtension(mimeType = "") {
    const normalizedMimeType = String(mimeType || "").trim().toLowerCase();
    const knownExtensionByMimeType = {
      "image/png": ".png",
      "image/jpeg": ".jpg",
      "image/webp": ".webp",
      "image/gif": ".gif",
      "image/bmp": ".bmp",
      "image/svg+xml": ".svg",
      "video/mp4": ".mp4",
      "video/webm": ".webm",
      "video/quicktime": ".mov",
      "video/x-msvideo": ".avi",
      "video/x-matroska": ".mkv",
      "video/x-m4v": ".m4v",
    };
    return String(knownExtensionByMimeType[normalizedMimeType] || "");
  }

  _normalizeExtension(fileName = "", mimeType = "") {
    const extensionFromFileName = path.extname(String(fileName || "")).slice(0, 20);
    if (extensionFromFileName) return extensionFromFileName;
    return this._mimeTypeToExtension(mimeType).slice(0, 20);
  }

  async _saveAttachmentRecord({
    basePath,
    attachmentIndex,
    name = "",
    mimeType = "application/octet-stream",
    contentBytes = Buffer.alloc(0),
    generatedByModel = false,
    generationSource = "",
  }) {
    const attachmentId = uuidv4();
    const extension = this._normalizeExtension(name, mimeType);
    const fileName = `${attachmentId}${extension}`;
    const savePath = path.join(this._attachRoot(basePath), fileName);
    const now = new Date().toISOString();
    await writeFile(savePath, contentBytes);
    const attachmentRecord = this._buildAttachmentPublicRecord(basePath, {
      attachmentId,
      name,
      mimeType,
      size: contentBytes.length,
      path: savePath,
      createdAt: now,
      generatedByModel,
      generationSource,
    });
    attachmentIndex.attachments[attachmentId] = attachmentRecord;
    return attachmentRecord;
  }

  _resolveAttachmentPolicy(attachmentPolicy = {}) {
    const policyConfig =
      attachmentPolicy && typeof attachmentPolicy === "object"
        ? attachmentPolicy
        : {};
    const maxFileSizeBytes = Number(
      policyConfig?.maxFileSizeBytes ?? policyConfig?.max_file_size_bytes ?? 0,
    );
    const maxTotalSizeBytes = Number(
      policyConfig?.maxTotalSizeBytes ?? policyConfig?.max_total_size_bytes ?? 0,
    );
    const maxFileCount = Number(
      policyConfig?.maxFileCount ?? policyConfig?.max_file_count ?? 0,
    );
    const allowedMimeTypes = Array.isArray(
      policyConfig?.allowedMimeTypes ?? policyConfig?.allowed_mime_types,
    )
      ? (policyConfig?.allowedMimeTypes ?? policyConfig?.allowed_mime_types)
          .map((item) => String(item || "").trim().toLowerCase())
          .filter(Boolean)
      : [];
    const allowedExtensions = Array.isArray(
      policyConfig?.allowedExtensions ?? policyConfig?.allowed_extensions,
    )
      ? (policyConfig?.allowedExtensions ?? policyConfig?.allowed_extensions)
          .map((item) => {
            const normalized = String(item || "").trim().toLowerCase();
            if (!normalized) return "";
            return normalized.startsWith(".") ? normalized : `.${normalized}`;
          })
          .filter(Boolean)
      : [];
    return {
      maxFileSizeBytes:
        Number.isFinite(maxFileSizeBytes) && maxFileSizeBytes > 0
          ? Math.floor(maxFileSizeBytes)
          : 0,
      maxTotalSizeBytes:
        Number.isFinite(maxTotalSizeBytes) && maxTotalSizeBytes > 0
          ? Math.floor(maxTotalSizeBytes)
          : 0,
      maxFileCount:
        Number.isFinite(maxFileCount) && maxFileCount > 0
          ? Math.floor(maxFileCount)
          : 0,
      allowedMimeTypes,
      allowedExtensions,
    };
  }

  _isMimeTypeAllowed(mimeType = "", allowedMimeTypes = []) {
    const normalizedMimeType = String(mimeType || "").trim().toLowerCase();
    const whitelist = Array.isArray(allowedMimeTypes) ? allowedMimeTypes : [];
    if (!whitelist.length || !normalizedMimeType) return true;
    return whitelist.some((allowedMimeType) => {
      const normalizedAllowedMimeType = String(allowedMimeType || "")
        .trim()
        .toLowerCase();
      if (!normalizedAllowedMimeType) return false;
      if (normalizedAllowedMimeType.endsWith("/*")) {
        const mimePrefix = normalizedAllowedMimeType.slice(0, -1);
        return normalizedMimeType.startsWith(mimePrefix);
      }
      return normalizedMimeType === normalizedAllowedMimeType;
    });
  }

  _isExtensionAllowed(fileName = "", allowedExtensions = []) {
    const whitelist = Array.isArray(allowedExtensions) ? allowedExtensions : [];
    if (!whitelist.length) return true;
    const normalizedExtension = String(path.extname(String(fileName || "")) || "")
      .trim()
      .toLowerCase();
    if (!normalizedExtension) return false;
    return whitelist.includes(normalizedExtension);
  }

  async ingest({ userId, attachments, attachmentPolicy = {} }) {
    const basePath = this._resolveBasePath(userId);
    if (!attachments?.length) return [];
    const resolvedPolicy = this._resolveAttachmentPolicy(attachmentPolicy);
    if (
      resolvedPolicy.maxFileCount > 0 &&
      attachments.length > resolvedPolicy.maxFileCount
    ) {
      throw recoverableToolError(
        `attachments count exceeds limit: ${attachments.length} > ${resolvedPolicy.maxFileCount}`,
        {
          code: "RECOVERABLE_ATTACHMENT_COUNT_LIMIT_EXCEEDED",
          details: {
            receivedCount: attachments.length,
            maxFileCount: resolvedPolicy.maxFileCount,
            hint: "increase attachments.max_file_count or reduce uploaded files",
          },
        },
      );
    }
    const attachmentIndex = await this._readAttachIndex(basePath);
    const savedAttachmentRecords = [];
    let totalUploadedBytes = 0;

    for (const item of attachments) {
      const { name, contentBase64, mimeType = "application/octet-stream" } = item;
      if (!name || !contentBase64) continue;
      const normalizedMimeType = String(mimeType || "application/octet-stream")
        .trim()
        .toLowerCase();
      if (
        !this._isMimeTypeAllowed(
          normalizedMimeType,
          resolvedPolicy.allowedMimeTypes,
        )
      ) {
        throw new Error(`attachment mime type not allowed: ${normalizedMimeType}`);
      }
      if (
        !this._isExtensionAllowed(String(name || ""), resolvedPolicy.allowedExtensions)
      ) {
        throw recoverableToolError(
          `attachment extension not allowed: ${String(name || "")}`,
          {
            code: "RECOVERABLE_ATTACHMENT_EXTENSION_NOT_ALLOWED",
            details: {
              fileName: String(name || ""),
              allowedExtensions: resolvedPolicy.allowedExtensions,
              hint: "add extension to attachments.allowed_extensions",
            },
          },
        );
      }
      const bytes = Buffer.from(contentBase64, "base64");
      if (
        resolvedPolicy.maxFileSizeBytes > 0 &&
        bytes.length > resolvedPolicy.maxFileSizeBytes
      ) {
        throw recoverableToolError(
          `attachment too large: ${String(name || "")}, ${bytes.length} > ${resolvedPolicy.maxFileSizeBytes}`,
          {
            code: "RECOVERABLE_ATTACHMENT_FILE_SIZE_LIMIT_EXCEEDED",
            details: {
              fileName: String(name || ""),
              fileSizeBytes: bytes.length,
              maxFileSizeBytes: resolvedPolicy.maxFileSizeBytes,
              hint: "increase attachments.max_file_size_bytes or upload a smaller file",
            },
          },
        );
      }
      totalUploadedBytes += bytes.length;
      if (
        resolvedPolicy.maxTotalSizeBytes > 0 &&
        totalUploadedBytes > resolvedPolicy.maxTotalSizeBytes
      ) {
        throw recoverableToolError(
          `attachments total size exceeds limit: ${totalUploadedBytes} > ${resolvedPolicy.maxTotalSizeBytes}`,
          {
            code: "RECOVERABLE_ATTACHMENT_TOTAL_SIZE_LIMIT_EXCEEDED",
            details: {
              totalSizeBytes: totalUploadedBytes,
              maxTotalSizeBytes: resolvedPolicy.maxTotalSizeBytes,
              hint: "increase attachments.max_total_size_bytes or reduce upload size",
            },
          },
        );
      }
      const attachmentRecord = await this._saveAttachmentRecord({
        basePath,
        attachmentIndex,
        name: String(name || ""),
        mimeType: normalizedMimeType || "application/octet-stream",
        contentBytes: bytes,
      });
      savedAttachmentRecords.push(attachmentRecord);
    }

    await this._writeAttachIndex(basePath, attachmentIndex);
    return savedAttachmentRecords;
  }

  async ingestGeneratedArtifacts({
    userId,
    artifacts = [],
    generationSource = "llm_output",
  }) {
    const basePath = this._resolveBasePath(userId);
    const sourceArtifacts = Array.isArray(artifacts) ? artifacts : [];
    if (!sourceArtifacts.length) return [];
    const attachmentIndex = await this._readAttachIndex(basePath);
    const savedAttachmentRecords = [];
    for (const artifactItem of sourceArtifacts) {
      const artifactName = String(artifactItem?.name || "").trim();
      const artifactContentBase64 = String(artifactItem?.contentBase64 || "").trim();
      if (!artifactName || !artifactContentBase64) continue;
      const artifactMimeType = String(
        artifactItem?.mimeType || "application/octet-stream",
      )
        .trim()
        .toLowerCase();
      const artifactBytes = Buffer.from(artifactContentBase64, "base64");
      const attachmentRecord = await this._saveAttachmentRecord({
        basePath,
        attachmentIndex,
        name: artifactName,
        mimeType: artifactMimeType || "application/octet-stream",
        contentBytes: artifactBytes,
        generatedByModel: true,
        generationSource,
      });
      savedAttachmentRecords.push(attachmentRecord);
    }
    await this._writeAttachIndex(basePath, attachmentIndex);
    return savedAttachmentRecords;
  }

  async getAttachmentById({ userId, attachmentId }) {
    const normalizedAttachmentId = String(attachmentId || "").trim();
    if (!normalizedAttachmentId) return null;
    const basePath = this._resolveBasePath(userId);
    const attachmentIndex = await this._readAttachIndex(basePath);
    const record = attachmentIndex?.attachments?.[normalizedAttachmentId];
    if (!record) return null;

    const resolvedPath = String(record.path || "");
    if (!resolvedPath) return null;
    try {
      await access(resolvedPath);
    } catch {
      return null;
    }

    const fileStat = await stat(resolvedPath);
    return {
      ...this._buildAttachmentPublicRecord(basePath, record),
      absolutePath: resolvedPath,
      size: Number(fileStat.size || record.size || 0),
    };
  }

  async readAttachmentContent({ userId, attachmentId }) {
    const record = await this.getAttachmentById({ userId, attachmentId });
    if (!record) return null;
    return {
      ...record,
      content: await readFile(record.absolutePath),
    };
  }
}
