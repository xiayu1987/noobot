/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

import { filePath as path } from "../../utils/path-resolver.js";
import { readdir } from "node:fs/promises";

import { fsReadFile, fsWriteFile } from "../../store/fs-adapter.js";
import { safeStr } from "../../utils/shared-utils.js";
import { readAttachIndex, writeAttachIndex } from "../index-manager.js";
import { attachScopedRoot, resolveBasePath } from "./attachment-scope-resolver.js";
import { buildPublicRecord } from "./record-builder.js";
import { buildSessionDisplaySummary } from "../../session/session-summary-builders.js";

export async function linkParsedResultToAttachment(service, {
  userId,
  sourceAttachmentId = "",
  parsedAttachmentMeta = {},
  toolName = "",
  sourceSessionId = "",
  sourceAttachmentSource = "",
  sourceAttachmentPath = "",
} = {}) {
  const sourceId = safeStr(sourceAttachmentId);
  const parsedId = safeStr(parsedAttachmentMeta?.attachmentId);
  if (!userId || !sourceId || !parsedId) return null;

  const basePath = resolveBasePath(service.globalConfig, userId);
  const scopedRoot = attachScopedRoot(basePath);
  const normalizedSessionId = safeStr(sourceSessionId);
  const normalizedAttachmentSource = safeStr(sourceAttachmentSource).toLowerCase();
  const normalizedSourcePath = safeStr(sourceAttachmentPath);

  const scopedCandidates = await buildLinkParsedScopeCandidates({
    scopedRoot,
    sessionId: normalizedSessionId,
    attachmentSource: normalizedAttachmentSource,
  });

  let updatedRecord = await linkParsedResultInScopes({
    basePath,
    scopes: scopedCandidates,
    sourceAttachmentId: sourceId,
    parsedAttachmentMeta,
    toolName,
    sourceAttachmentPath: normalizedSourcePath,
  });

  if (!updatedRecord) {
    const fallbackScopes = await buildLinkParsedScopeCandidates({
      scopedRoot,
      sessionId: "",
      attachmentSource: "",
    });
    updatedRecord = await linkParsedResultInScopes({
      basePath,
      scopes: fallbackScopes,
      sourceAttachmentId: sourceId,
      parsedAttachmentMeta,
      toolName,
      sourceAttachmentPath: normalizedSourcePath,
    });
  }

  if (updatedRecord) {
    const resolvedSessionIdHint = normalizedSessionId || safeStr(updatedRecord?.sessionId);
    const resolvedSourcePath = safeStr(updatedRecord?.path) || normalizedSourcePath;
    await Promise.all([
      syncParsedResultToSessionSnapshots({
        basePath,
        sourceAttachmentId: sourceId,
        sourceAttachmentPath: resolvedSourcePath,
        updatedSourceAttachment: updatedRecord,
        sessionIdHint: resolvedSessionIdHint,
        sessionRoot: path.join(basePath, "runtime/session"),
      }),
      syncParsedResultToSessionSnapshots({
        basePath,
        sourceAttachmentId: sourceId,
        sourceAttachmentPath: resolvedSourcePath,
        updatedSourceAttachment: updatedRecord,
        sessionIdHint: resolvedSessionIdHint,
        sessionRoot: path.join(basePath, "runtime/plugin/session"),
      }),
    ]);
  }

  return updatedRecord || null;
}

export async function buildLinkParsedScopeCandidates({ scopedRoot = "", sessionId = "", attachmentSource = "" } = {}) {
  const normalizedSessionId = safeStr(sessionId);
  const normalizedAttachmentSource = safeStr(attachmentSource).toLowerCase();
  const scopes = [];
  const dedupe = new Set();
  const pushScope = (scopeSessionId = "", scopeAttachmentSource = "") => {
    const normalizedScopeSessionId = safeStr(scopeSessionId);
    const normalizedScopeAttachmentSource = safeStr(scopeAttachmentSource).toLowerCase();
    if (!normalizedScopeSessionId || !normalizedScopeAttachmentSource) return;
    const dedupeKey = `${normalizedScopeSessionId}::${normalizedScopeAttachmentSource}`;
    if (dedupe.has(dedupeKey)) return;
    dedupe.add(dedupeKey);
    scopes.push({ sessionId: normalizedScopeSessionId, attachmentSource: normalizedScopeAttachmentSource });
  };

  if (normalizedSessionId && normalizedAttachmentSource) {
    pushScope(normalizedSessionId, normalizedAttachmentSource);
    return scopes;
  }

  if (normalizedSessionId) {
    const sessionRoot = path.join(scopedRoot, normalizedSessionId);
    let sourceEntries = [];
    try {
      sourceEntries = await readdir(sessionRoot, { withFileTypes: true });
    } catch {
      sourceEntries = [];
    }
    for (const sourceEntry of sourceEntries) {
      if (!sourceEntry?.isDirectory?.()) continue;
      if (normalizedAttachmentSource && sourceEntry.name !== normalizedAttachmentSource) continue;
      pushScope(normalizedSessionId, sourceEntry.name);
    }
    return scopes;
  }

  let sessionEntries = [];
  try {
    sessionEntries = await readdir(scopedRoot, { withFileTypes: true });
  } catch {
    return scopes;
  }
  for (const sessionEntry of sessionEntries) {
    if (!sessionEntry?.isDirectory?.()) continue;
    const sessionRoot = path.join(scopedRoot, sessionEntry.name);
    let sourceEntries = [];
    try {
      sourceEntries = await readdir(sessionRoot, { withFileTypes: true });
    } catch {
      sourceEntries = [];
    }
    for (const sourceEntry of sourceEntries) {
      if (!sourceEntry?.isDirectory?.()) continue;
      if (normalizedAttachmentSource && sourceEntry.name !== normalizedAttachmentSource) continue;
      pushScope(sessionEntry.name, sourceEntry.name);
    }
  }
  return scopes;
}

export async function linkParsedResultInScopes({
  basePath = "",
  scopes = [],
  sourceAttachmentId = "",
  parsedAttachmentMeta = {},
  toolName = "",
  sourceAttachmentPath = "",
} = {}) {
  const normalizedSourceId = safeStr(sourceAttachmentId);
  const normalizedSourcePath = safeStr(sourceAttachmentPath);
  if (!normalizedSourceId || !Array.isArray(scopes) || !scopes.length) return null;

  for (const scope of scopes) {
    const index = await readAttachIndex(basePath, scope);
    const sourceRecord = index?.attachments?.[normalizedSourceId];
    if (!sourceRecord) continue;
    if (!isAttachmentPathMatch({ expectedPath: normalizedSourcePath, actualPath: safeStr(sourceRecord?.path) })) {
      continue;
    }
    const nextRecord = {
      ...sourceRecord,
      parsedResult: {
        attachmentId: safeStr(parsedAttachmentMeta?.attachmentId),
        path: safeStr(parsedAttachmentMeta?.path),
        relativePath: safeStr(parsedAttachmentMeta?.relativePath),
        tool: safeStr(toolName),
        updatedAt: new Date().toISOString(),
      },
    };
    const sourceContentSha256 = safeStr(sourceRecord?.contentSha256);
    for (const [attachmentId, record] of Object.entries(index.attachments || {})) {
      const sameAttachment = attachmentId === normalizedSourceId;
      const sameContent = sourceContentSha256 && safeStr(record?.contentSha256) === sourceContentSha256;
      if (!sameAttachment && !sameContent) continue;
      index.attachments[attachmentId] = {
        ...record,
        parsedResult: nextRecord.parsedResult,
      };
    }
    await writeAttachIndex(basePath, index, scope);
    return buildPublicRecord(basePath, nextRecord);
  }
  return null;
}

export function isAttachmentPathMatch({ expectedPath = "", actualPath = "" } = {}) {
  const normalizedExpectedPath = safeStr(expectedPath);
  if (!normalizedExpectedPath) return true;
  const normalizedActualPath = safeStr(actualPath);
  if (!normalizedActualPath) return false;
  return path.normalize(normalizedExpectedPath) === path.normalize(normalizedActualPath);
}

export async function syncParsedResultToSessionSnapshots({
  basePath = "",
  sourceAttachmentId = "",
  sourceAttachmentPath = "",
  updatedSourceAttachment = {},
  sessionIdHint = "",
  sessionRoot = "",
} = {}) {
  const normalizedAttachmentId = safeStr(sourceAttachmentId);
  if (!normalizedAttachmentId) return;

  const resolvedSessionRoot = safeStr(sessionRoot) || path.join(basePath, "runtime/session");
  const sessionJsonFiles = await collectSessionJsonFiles({ sessionRoot: resolvedSessionRoot, sessionIdHint });
  if (!sessionJsonFiles.length) return;

  const nextParsedResult = updatedSourceAttachment?.parsedResult &&
    typeof updatedSourceAttachment.parsedResult === "object" &&
    !Array.isArray(updatedSourceAttachment.parsedResult)
    ? updatedSourceAttachment.parsedResult
    : {};
  const normalizedSourcePath = safeStr(sourceAttachmentPath);
  const normalizedContentSha256 = safeStr(updatedSourceAttachment?.contentSha256);

  for (const sessionJsonFile of sessionJsonFiles) {
    let raw = "";
    try {
      raw = await fsReadFile(sessionJsonFile, "utf8");
    } catch {
      continue;
    }
    let sessionPayload = null;
    try {
      sessionPayload = JSON.parse(raw);
    } catch {
      continue;
    }
    const messages = Array.isArray(sessionPayload?.messages) ? sessionPayload.messages : [];
    let changed = false;
    const syncAttachmentBucket = (attachmentItems = []) => {
      if (!Array.isArray(attachmentItems) || !attachmentItems.length) {
        return { items: attachmentItems, changed: false };
      }
      let bucketChanged = false;
      const nextItems = attachmentItems.map((attachmentItem) => {
        const attachmentId = safeStr(attachmentItem?.attachmentId);
        const attachmentPath = safeStr(attachmentItem?.path);
        const sameAttachmentId = attachmentId === normalizedAttachmentId &&
          isAttachmentPathMatch({ expectedPath: normalizedSourcePath, actualPath: attachmentPath });
        const sameContent = normalizedContentSha256 &&
          safeStr(attachmentItem?.contentSha256) === normalizedContentSha256;
        const isMatchedAttachment = sameAttachmentId || sameContent;
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
      const attachments = Array.isArray(messageItem?.attachments)
        ? messageItem.attachments
        : [];
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
      await fsWriteFile(sessionJsonFile, `${JSON.stringify(nextSessionPayload, null, 2)}\n`, "utf8");
      await syncSessionSummaryForSessionFile(sessionJsonFile, nextSessionPayload);
    } catch {
      // ignore snapshot sync failures
    }
  }
}

async function syncSessionSummaryForSessionFile(sessionJsonFile = "", sessionPayload = {}) {
  const summaryFile = path.join(path.dirname(sessionJsonFile), "session-summary.json");
  let depth = 0;
  try {
    const existingSummary = JSON.parse(await fsReadFile(summaryFile, "utf8"));
    if (Number.isFinite(Number(existingSummary?.depth))) depth = Number(existingSummary.depth);
  } catch {
    depth = 0;
  }
  const summaryPayload = buildSessionDisplaySummary(sessionPayload, { depth });
  await fsWriteFile(summaryFile, `${JSON.stringify(summaryPayload, null, 2)}\n`, "utf8");
}

export async function collectSessionJsonFiles({ sessionRoot = "", sessionIdHint = "" } = {}) {
  const normalizedSessionRoot = safeStr(sessionRoot);
  if (!normalizedSessionRoot) return [];
  const normalizedHint = safeStr(sessionIdHint);
  const candidateRoots = normalizedHint
    ? [path.join(normalizedSessionRoot, normalizedHint), normalizedSessionRoot]
    : [normalizedSessionRoot];
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
