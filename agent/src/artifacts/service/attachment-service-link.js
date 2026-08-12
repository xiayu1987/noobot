/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

import { filePath as path } from "@noobot/path-resolver";
import { readdir } from "node:fs/promises";

import { fsWriteFile } from "../../shared/storage/fs-adapter.js";
import { safeStr } from "../../shared/utils/shared-utils.js";
import { readAttachIndex, withAttachIndexLock, writeAttachIndex } from "../index-manager.js";
import { resolveBasePath } from "./attachment-scope-resolver.js";
import { buildPublicRecord } from "./record-builder.js";
import { buildSessionDisplaySummary } from "../../session/session-summary-builders.js";
import { readSessionArtifact, writeSessionArtifact } from "../../session/session-artifact-store.js";

export async function linkParsedResultToAttachment(
  service,
  {
    userId,
    sourceAttachmentId = "",
    parsedAttachmentMeta = {},
    toolName = "",
    sourceSessionId = "",
    sourceAttachmentSource = "",
  } = {},
) {
  const sourceId = safeStr(sourceAttachmentId);
  const parsedId = safeStr(parsedAttachmentMeta?.attachmentId);
  if (!userId || !sourceId || !parsedId) return null;

  const basePath = resolveBasePath(service.globalConfig, userId);
  const normalizedSessionId = safeStr(sourceSessionId);
  const normalizedAttachmentSource = safeStr(sourceAttachmentSource).toLowerCase();
  if (!normalizedSessionId || !normalizedAttachmentSource) return null;

  const scopedCandidates = buildLinkParsedScopeCandidates({
    sessionId: normalizedSessionId,
    attachmentSource: normalizedAttachmentSource,
  });

  const updatedRecord = await linkParsedResultInScopes({
    basePath,
    scopes: scopedCandidates,
    sourceAttachmentId: sourceId,
    parsedAttachmentMeta,
    toolName,
    sourceSessionId: normalizedSessionId,
    sourceAttachmentSource: normalizedAttachmentSource,
  });

  if (updatedRecord) {
    await Promise.all([
      syncParsedResultToSessionSnapshots({
        basePath,
        sourceAttachmentId: sourceId,
        sourceSessionId: normalizedSessionId,
        sourceAttachmentSource: normalizedAttachmentSource,
        updatedSourceAttachment: updatedRecord,
        sessionRoot: path.join(basePath, "runtime/session"),
      }),
      syncParsedResultToSessionSnapshots({
        basePath,
        sourceAttachmentId: sourceId,
        sourceSessionId: normalizedSessionId,
        sourceAttachmentSource: normalizedAttachmentSource,
        updatedSourceAttachment: updatedRecord,
        sessionRoot: path.join(basePath, "runtime/plugin/session"),
      }),
    ]);
  }

  return updatedRecord || null;
}

export function buildLinkParsedScopeCandidates({ sessionId = "", attachmentSource = "" } = {}) {
  const normalizedSessionId = safeStr(sessionId);
  const normalizedAttachmentSource = safeStr(attachmentSource).toLowerCase();
  if (!normalizedSessionId || !normalizedAttachmentSource) return [];
  return [{ sessionId: normalizedSessionId, attachmentSource: normalizedAttachmentSource }];
}

export async function linkParsedResultInScopes({
  basePath = "",
  scopes = [],
  sourceAttachmentId = "",
  sourceSessionId = "",
  sourceAttachmentSource = "",
  parsedAttachmentMeta = {},
  toolName = "",
} = {}) {
  const normalizedSourceId = safeStr(sourceAttachmentId);
  const normalizedSessionId = safeStr(sourceSessionId);
  const normalizedAttachmentSource = safeStr(sourceAttachmentSource).toLowerCase();
  if (
    !normalizedSourceId ||
    !normalizedSessionId ||
    !normalizedAttachmentSource ||
    !Array.isArray(scopes) ||
    !scopes.length
  )
    return null;

  for (const scope of scopes) {
    if (
      scope?.sessionId !== normalizedSessionId ||
      scope?.attachmentSource !== normalizedAttachmentSource
    )
      continue;
    const result = await withAttachIndexLock(basePath, scope, async () => {
      const index = await readAttachIndex(basePath, scope);
      const sourceRecord = index?.attachments?.[normalizedSourceId];
      if (!sourceRecord) return null;
      const nextRecord = {
        ...sourceRecord,
        parsedResult: {
          attachmentId: safeStr(parsedAttachmentMeta?.attachmentId),
          sessionId: safeStr(parsedAttachmentMeta?.sessionId),
          attachmentSource: safeStr(parsedAttachmentMeta?.attachmentSource).toLowerCase(),
          name: safeStr(parsedAttachmentMeta?.name),
          mimeType: safeStr(parsedAttachmentMeta?.mimeType),
          size: Number(parsedAttachmentMeta?.size || 0),
          path: safeStr(parsedAttachmentMeta?.path),
          relativePath: safeStr(parsedAttachmentMeta?.relativePath),
          tool: safeStr(toolName),
          updatedAt: new Date().toISOString(),
        },
      };
      index.attachments[normalizedSourceId] = {
        ...sourceRecord,
        parsedResult: nextRecord.parsedResult,
      };
      await writeAttachIndex(basePath, index, scope);
      return buildPublicRecord(basePath, nextRecord);
    });
    if (result) return result;
  }
  return null;
}

export async function syncParsedResultToSessionSnapshots({
  basePath = "",
  sourceAttachmentId = "",
  sourceSessionId = "",
  sourceAttachmentSource = "",
  updatedSourceAttachment = {},
  sessionRoot = "",
} = {}) {
  const normalizedAttachmentId = safeStr(sourceAttachmentId);
  const normalizedSessionId = safeStr(sourceSessionId);
  const normalizedAttachmentSource = safeStr(sourceAttachmentSource).toLowerCase();
  if (!normalizedAttachmentId || !normalizedSessionId || !normalizedAttachmentSource) return;

  const resolvedSessionRoot = safeStr(sessionRoot) || path.join(basePath, "runtime/session");
  const sessionJsonFiles = await collectSessionJsonFiles({
    sessionRoot: resolvedSessionRoot,
    sessionId: normalizedSessionId,
  });
  if (!sessionJsonFiles.length) return;

  const nextParsedResult =
    updatedSourceAttachment?.parsedResult &&
    typeof updatedSourceAttachment.parsedResult === "object" &&
    !Array.isArray(updatedSourceAttachment.parsedResult)
      ? updatedSourceAttachment.parsedResult
      : {};

  for (const sessionJsonFile of sessionJsonFiles) {
    const sessionDir = path.dirname(sessionJsonFile);
    const sessionPayload = await readSessionArtifact({ sessionDir, fallback: null });
    if (!sessionPayload) continue;
    const messages = Array.isArray(sessionPayload?.messages) ? sessionPayload.messages : [];
    let changed = false;
    const syncAttachmentBucket = (attachmentItems = []) => {
      if (!Array.isArray(attachmentItems) || !attachmentItems.length) {
        return { items: attachmentItems, changed: false };
      }
      let bucketChanged = false;
      const nextItems = attachmentItems.map((attachmentItem) => {
        const attachmentId = safeStr(attachmentItem?.attachmentId);
        const sameAttachmentId =
          attachmentId === normalizedAttachmentId &&
          safeStr(attachmentItem?.sessionId) === normalizedSessionId &&
          safeStr(attachmentItem?.attachmentSource).toLowerCase() === normalizedAttachmentSource;
        const isMatchedAttachment = sameAttachmentId;
        if (!isMatchedAttachment) return attachmentItem;
        bucketChanged = true;
        return {
          ...(attachmentItem || {}),
          ...(Object.keys(nextParsedResult).length ? { parsedResult: nextParsedResult } : {}),
        };
      });
      return { items: nextItems, changed: bucketChanged };
    };
    const nextMessages = messages.map((messageItem) => {
      const attachments = Array.isArray(messageItem?.attachments) ? messageItem.attachments : [];
      const syncedAttachments = syncAttachmentBucket(attachments);
      if (!syncedAttachments.changed) return messageItem;
      changed = true;
      const nextMessage = {
        ...(messageItem || {}),
        ...(attachments.length ? { attachments: syncedAttachments.items } : {}),
      };
      return nextMessage;
    });
    if (!changed) continue;
    const nextSessionPayload = { ...(sessionPayload || {}), messages: nextMessages };
    try {
      await writeSessionArtifact({ sessionDir, sessionPayload: nextSessionPayload });
      await syncSessionSummaryForSessionFile(sessionJsonFile, nextSessionPayload);
    } catch {}
  }
}

async function syncSessionSummaryForSessionFile(sessionJsonFile = "", sessionPayload = {}) {
  const summaryFile = path.join(path.dirname(sessionJsonFile), "session-summary.json");
  const summaryPayload = buildSessionDisplaySummary(sessionPayload);
  await fsWriteFile(summaryFile, `${JSON.stringify(summaryPayload, null, 2)}\n`, "utf8");
}

export async function collectSessionJsonFiles({ sessionRoot = "", sessionId = "" } = {}) {
  const normalizedSessionRoot = safeStr(sessionRoot);
  if (!normalizedSessionRoot) return [];
  const normalizedSessionId = safeStr(sessionId);
  if (!normalizedSessionId) return [];
  const candidateRoots = [path.join(normalizedSessionRoot, normalizedSessionId)];
  const discovered = [];
  const visited = new Set();

  for (const rootPath of candidateRoots) {
    const normalizedRootPath = path.normalize(String(rootPath || ""));
    if (!normalizedRootPath || visited.has(normalizedRootPath)) continue;
    visited.add(normalizedRootPath);
    const files = await walkSessionJsonFilesFromRoot(normalizedRootPath);
    for (const filePath of files) {
      const normalizedFilePath = path.normalize(String(filePath || ""));
      if (!normalizedFilePath || visited.has(normalizedFilePath)) continue;
      visited.add(normalizedFilePath);
      discovered.push(normalizedFilePath);
    }
  }
  return discovered;
}

export async function walkSessionJsonFilesFromRoot(rootPath = "") {
  let entries = [];
  try {
    entries = await readdir(rootPath, { withFileTypes: true });
  } catch {
    return [];
  }
  const discovered = [];
  for (const entry of entries) {
    const entryPath = path.join(rootPath, entry.name);
    if (entry?.isDirectory?.()) {
      const childFiles = await walkSessionJsonFilesFromRoot(entryPath);
      discovered.push(...childFiles);
      continue;
    }
    if (entry?.isFile?.() && entry.name === "session.json") {
      discovered.push(entryPath);
    }
  }
  return discovered;
}
