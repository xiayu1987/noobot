/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { filePath as path } from "../utils/path-resolver.js";
import {
  getBasePathFromAgentContext,
  getRuntimeFromAgentContext,
  getSessionIdsFromAgentContext,
} from "../context/agent-context-accessor.js";
import { resolveRuntimeUserMessageAttachments } from "./runtime-user-message-attachments.js";
import { resolveAttachmentDisplayPath, resolveHostPath } from "../utils/path-resolver.js";

function normalizeComparablePath(filePath = "", basePath = "") {
  const normalizedPath = String(filePath || "").trim();
  if (!normalizedPath) return "";
  return path.resolve(path.isAbsolute(normalizedPath)
    ? normalizedPath
    : path.join(String(basePath || "").trim(), normalizedPath));
}

/**
 * Resolve one canonical user attachment in the root conversation scope.
 * A canonical ID is preferred; an exact scoped path is an equally valid proof
 * when a model omits or corrupts the optional ID argument.
 */
export async function resolveCanonicalUserSourceAttachment({
  filePath = "",
  attachmentId = "",
  agentContext = {},
} = {}) {
  const runtime = getRuntimeFromAgentContext(agentContext);
  const basePath = getBasePathFromAgentContext(agentContext, runtime);
  const normalizedAttachmentId = String(attachmentId || "").trim();
  const comparableInputPath = normalizeComparablePath(filePath, basePath);
  const runtimeAttachmentMetas = resolveRuntimeUserMessageAttachments(runtime);
  const runtimeIdMatch = normalizedAttachmentId
    ? runtimeAttachmentMetas.find(
      (attachmentItem) => String(attachmentItem?.attachmentId || "").trim() === normalizedAttachmentId,
    ) || null
    : null;
  const runtimePathMatch = comparableInputPath
    ? runtimeAttachmentMetas.find((attachmentItem) => {
      const comparableMetaPath = normalizeComparablePath(
      attachmentItem?.path || attachmentItem?.relativePath,
      basePath,
      );
      return comparableMetaPath === comparableInputPath;
    }) || null
    : null;
  if (runtimeIdMatch && runtimePathMatch) {
    return runtimeIdMatch === runtimePathMatch ? runtimeIdMatch : null;
  }
  if (runtimeIdMatch && !comparableInputPath) return runtimeIdMatch;
  if (!runtimeIdMatch && runtimePathMatch) return runtimePathMatch;

  const attachmentService = runtime?.attachmentService || null;
  const { userId, sessionId, parentSessionId, rootSessionId } =
    getSessionIdsFromAgentContext(agentContext, runtime);
  const sourceSessionId = rootSessionId || parentSessionId || sessionId;
  if (!attachmentService?.resolveSourceAttachment || !userId || !sourceSessionId) return null;

  const pathCandidates = [];
  const pushPathCandidate = (value = "") => {
    const normalized = String(value || "").trim();
    if (normalized && !pathCandidates.includes(normalized)) pathCandidates.push(normalized);
  };
  pushPathCandidate(filePath);
  pushPathCandidate(resolveHostPath({
    runtime,
    agentContext,
    path: filePath,
  }));
  pushPathCandidate(resolveAttachmentDisplayPath({
    runtime,
    agentContext,
    path: filePath,
    purpose: "source_attachment_compat_file_path",
  }));
  if (!pathCandidates.length) pathCandidates.push("");

  for (const candidatePath of pathCandidates) {
    const resolved = await attachmentService.resolveSourceAttachment({
      userId,
      sessionId: sourceSessionId,
      attachmentId: normalizedAttachmentId,
      attachmentSource: "user",
      filePath: candidatePath,
    });
    if (resolved) return resolved;
  }
  return null;
}
