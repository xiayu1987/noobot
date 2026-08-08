/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { logger } from "../../observability/index.js";
import { emitEvent } from "../../events/index.js";
import { tEngine } from "../../runtime/i18n-adapter.js";
import {
  parseDataUrl,
  sanitizeGeneratedArtifactName,
} from "../../shared/utils/mime-utils.js";
import { resolveDialogProcessIdFromContext } from "../../context/session/dialog-process-id-resolver.js";
import { MIME_TYPE } from "../../shared/constants/index.js";

export function extractGeneratedMediaCandidates(aiContent) {
  if (!Array.isArray(aiContent)) return [];
  const mediaCandidates = [];
  let mediaIndex = 0;
  for (const contentPart of aiContent) {
    if (!contentPart || typeof contentPart !== "object") continue;
    const partType = String(contentPart?.type || "").trim().toLowerCase();
    if (!partType.includes("image") && !partType.includes("video")) continue;

    const imageUrl = String(contentPart?.image_url?.url || "").trim();
    const videoUrl = String(contentPart?.video_url?.url || "").trim();
    const directUrl = String(contentPart?.url || "").trim();
    const sourceType = String(contentPart?.source?.type || "").trim().toLowerCase();
    const sourceMediaType = String(contentPart?.source?.media_type || "")
      .trim()
      .toLowerCase();
    const sourceData = String(contentPart?.source?.data || "").trim();
    const chosenUrl = imageUrl || videoUrl || directUrl;
    mediaIndex += 1;

    if (sourceType === "base64" && sourceData) {
      mediaCandidates.push({
        mediaType: partType.includes("video") ? "video" : "image",
        mimeType: sourceMediaType || MIME_TYPE.APPLICATION_OCTET_STREAM,
        contentBase64: sourceData,
        fileName: sanitizeGeneratedArtifactName(
          `${partType || "media"}_${mediaIndex}`,
          sourceMediaType,
          mediaIndex,
        ),
      });
      continue;
    }

    if (chosenUrl.startsWith("data:")) {
      const parsedDataUrl = parseDataUrl(chosenUrl);
      if (!parsedDataUrl) continue;
      mediaCandidates.push({
        mediaType: partType.includes("video") ? "video" : "image",
        mimeType: parsedDataUrl.mimeType,
        contentBase64: parsedDataUrl.contentBase64,
        fileName: sanitizeGeneratedArtifactName(
          `${partType || "media"}_${mediaIndex}`,
          parsedDataUrl.mimeType,
          mediaIndex,
        ),
      });
    }
  }
  return mediaCandidates;
}

export async function fetchRemoteMediaArtifact(
  url = "",
  fetchImpl = null,
  mediaIndex = 1,
  runtime = {},
) {
  const normalizedUrl = String(url || "").trim();
  if (!normalizedUrl || !/^https?:\/\//i.test(normalizedUrl)) return null;
  if (typeof fetchImpl !== "function") return null;

  try {
    const response = await fetchImpl(normalizedUrl);
    if (!response?.ok) {
      logger.error(
        tEngine(runtime, "fetchRemoteMediaArtifactFailed", {
          url: normalizedUrl,
          reason: tEngine(runtime, "fetchGeneratedMediaFailed", {
            status: response?.status || 500,
          }),
        }),
      );
      return null;
    }
    const responseArrayBuffer = await response.arrayBuffer();
    const responseBytes = Buffer.from(responseArrayBuffer);
    const contentTypeHeader = String(response.headers?.get?.("content-type") || "")
      .split(";")[0]
      .trim()
      .toLowerCase();
    return {
      mimeType: contentTypeHeader || MIME_TYPE.APPLICATION_OCTET_STREAM,
      contentBase64: responseBytes.toString("base64"),
      fileName: sanitizeGeneratedArtifactName(
        `generated_media_${mediaIndex}`,
        contentTypeHeader,
        mediaIndex,
      ),
    };
  } catch (error) {
    logger.error(
      tEngine(runtime, "fetchRemoteMediaArtifactFailed", {
        url: normalizedUrl,
        reason: error?.message || String(error || ""),
      }),
    );
    return null;
  }
}

function resolveGeneratedArtifactOwnership(runtime = {}, dialogProcessId = "") {
  const systemRuntime = runtime?.systemRuntime && typeof runtime.systemRuntime === "object"
    ? runtime.systemRuntime
    : {};
  const runConfig = runtime?.runConfig && typeof runtime.runConfig === "object"
    ? runtime.runConfig
    : systemRuntime?.runConfig && typeof systemRuntime.runConfig === "object"
      ? systemRuntime.runConfig
      : {};
  const turnScopeId = String(
    systemRuntime?.turnScopeId ||
      systemRuntime?.config?.turnScopeId ||
      runConfig?.turnScopeId ||
      "",
  ).trim();
  const resolvedDialogProcessId = resolveDialogProcessIdFromContext({
    dialogProcessId: dialogProcessId || systemRuntime?.dialogProcessId || systemRuntime?.currentDialogProcessId || "",
  });
  const sessionId = String(systemRuntime?.sessionId || systemRuntime?.rootSessionId || "").trim();
  return { turnScopeId, dialogProcessId: resolvedDialogProcessId, sessionId };
}

export async function persistModelGeneratedArtifacts({
  aiContent,
  runtime = {},
  eventListener = null,
  dialogProcessId = "",
  messageId = "",
}) {
  const attachmentService = runtime?.attachmentService || null;
  const userId = String(runtime?.userId || "").trim();
  if (!attachmentService || !userId) return [];
  const fetchImpl =
    typeof runtime?.sharedTools?.fetch === "function"
      ? runtime.sharedTools.fetch
      : typeof globalThis.fetch === "function"
        ? globalThis.fetch.bind(globalThis)
        : null;
  const localMediaCandidates = extractGeneratedMediaCandidates(aiContent);
  const remoteMediaCandidates = [];
  if (Array.isArray(aiContent)) {
    let remoteMediaIndex = 0;

    const fetchPromises = [];
    for (const contentPart of aiContent) {
      if (!contentPart || typeof contentPart !== "object") continue;
      const partType = String(contentPart?.type || "").trim().toLowerCase();
      if (!partType.includes("image") && !partType.includes("video")) continue;
      const imageUrl = String(contentPart?.image_url?.url || "").trim();
      const videoUrl = String(contentPart?.video_url?.url || "").trim();
      const directUrl = String(contentPart?.url || "").trim();
      const remoteUrl = imageUrl || videoUrl || directUrl;
      if (!/^https?:\/\//i.test(remoteUrl)) continue;
      remoteMediaIndex += 1;

      fetchPromises.push(
        fetchRemoteMediaArtifact(
          remoteUrl,
          fetchImpl,
          remoteMediaIndex,
          runtime,
        )
      );
    }

    if (fetchPromises.length > 0) {
      const results = await Promise.all(fetchPromises);
      for (const remoteArtifact of results) {
        if (remoteArtifact) remoteMediaCandidates.push(remoteArtifact);
      }
    }
  }
  const allMediaCandidates = [...localMediaCandidates, ...remoteMediaCandidates];
  if (!allMediaCandidates.length) return [];
  const ownership = resolveGeneratedArtifactOwnership(runtime, dialogProcessId);
  if (!String(messageId || "").trim() || !ownership.sessionId || !ownership.turnScopeId) {
    throw new Error("model_generated_artifact_ownership_incomplete");
  }
  const attachmentRecords = await attachmentService.ingestGeneratedArtifacts({
    userId,
    sessionId: ownership.sessionId,
    attachmentSource: "model",
    generationSource: "llm_output",
    turnScope: {
      sessionId: ownership.sessionId,
      turnScopeId: ownership.turnScopeId,
    },
    turnScopeId: ownership.turnScopeId,
    dialogProcessId: ownership.dialogProcessId,
    owner: { type: "model", id: String(messageId).trim() },
    artifacts: allMediaCandidates,
  });
  emitEvent(eventListener, "model_generated_attachments_saved", {
    dialogProcessId: resolveDialogProcessIdFromContext({ dialogProcessId }),
    count: attachmentRecords.length,
    attachments: attachmentRecords,
  });
  return attachmentRecords;
}
