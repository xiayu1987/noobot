/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { filePath as path } from "@noobot/path-resolver";
import { resolveContextMessageDialogProcessId } from "@noobot/context-protocol/message-codec";
import { SESSION_ARTIFACT_FILE_NAMES } from "../session-artifact-files.js";

export function splitSessionMessages(messages = [], dialogOrder = []) {
  const source = Array.isArray(messages) ? messages : [];
  const logicalOrder = new Map(
    (Array.isArray(dialogOrder) ? dialogOrder : []).map((entry, index) => [
      String(entry?.dialogProcessId || "").trim(),
      Number(entry?.dialogOrdinal) || index + 1,
    ]),
  );
  const buckets = new Map();
  source.forEach((message, sourceIndex) => {
    const dialogProcessId = resolveContextMessageDialogProcessId(message);
    const turnScopeId = String(message?.turnScopeId || "").trim();
    if (!turnScopeId || !dialogProcessId) {
      const error = new TypeError(
        `session message is missing Turn identity at index ${sourceIndex}`,
      );
      error.code = "SESSION_TURN_IDENTITY_REQUIRED";
      throw error;
    }
    const key = `turn:${turnScopeId}`;
    const bucket = buckets.get(key) || {
      dialogProcessId,
      turnScopeId,
      firstSourceIndex: sourceIndex,
      messages: [],
      sourceIndices: [],
    };
    if (bucket.dialogProcessId !== dialogProcessId) {
      const error = new TypeError(
        `turnScopeId ${turnScopeId} maps to multiple dialogProcessId values`,
      );
      error.code = "SESSION_TURN_IDENTITY_CONFLICT";
      throw error;
    }
    bucket.messages.push(message);
    bucket.sourceIndices.push(sourceIndex);
    buckets.set(key, bucket);
  });
  const ordered = [...buckets.values()].sort((left, right) => {
    const leftDialogOrdinal = logicalOrder.get(left.dialogProcessId);
    const rightDialogOrdinal = logicalOrder.get(right.dialogProcessId);
    if (Number.isFinite(leftDialogOrdinal) && Number.isFinite(rightDialogOrdinal))
      return leftDialogOrdinal - rightDialogOrdinal;
    if (Number.isFinite(leftDialogOrdinal) !== Number.isFinite(rightDialogOrdinal))
      return Number.isFinite(leftDialogOrdinal) ? -1 : 1;
    return left.firstSourceIndex - right.firstSourceIndex;
  });
  const turns = ordered.map((bucket, index) => {
    const artifactOrdinal = index + 1;
    return {
      turnId: `turn-${String(artifactOrdinal).padStart(6, "0")}`,
      artifactOrdinal,
      turnScopeId: bucket.turnScopeId,
      dialogProcessId: bucket.dialogProcessId,
      messages: bucket.messages,
      sourceIndices: bucket.sourceIndices,
    };
  });
  const locationBySourceIndex = new Map();
  for (const turn of turns) {
    turn.sourceIndices.forEach((sourceIndex, messageIndex) => {
      locationBySourceIndex.set(sourceIndex, { turnId: turn.turnId, messageIndex });
    });
  }
  const messageOrder = source.map((_, sourceIndex) => {
    const location = locationBySourceIndex.get(sourceIndex);
    return { turnId: location.turnId, messageIndex: location.messageIndex };
  });
  return { turns, messageOrder };
}

export function resolveTurnArtifactPath(sessionDir = "", file = "") {
  const reference = String(file || "").replaceAll("\\", "/");
  const normalized = path.normalize(reference);
  const turnsRoot = path.resolve(sessionDir, SESSION_ARTIFACT_FILE_NAMES.turnsDir);
  const resolved = path.resolve(sessionDir, normalized);
  if (
    !reference ||
    path.isAbsolute(reference) ||
    reference.includes("\0") ||
    normalized === "." ||
    normalized.startsWith(`..${path.sep}`) ||
    (resolved !== turnsRoot && !resolved.startsWith(`${turnsRoot}${path.sep}`)) ||
    ![".json", ".jsonl"].includes(path.extname(resolved))
  ) {
    const error = new Error(`invalid session turn artifact reference: ${reference}`);
    error.code = "SESSION_TURN_ARTIFACT_PATH_INVALID";
    throw error;
  }
  return resolved;
}
