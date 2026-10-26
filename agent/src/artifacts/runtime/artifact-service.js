/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { logger } from "../../observability/index.js";
import { emitEvent } from "../../events/index.js";
import { tEngine } from "../../runtime/i18n-adapter.js";
import { parseDataUrl, sanitizeGeneratedArtifactName } from "../../shared/utils/mime-utils.js";
import { MIME_TYPE } from "@noobot/attachment-protocol/mime";
import { normalizeDialogProcessId } from "@noobot/session-protocol";
import { ATTACHMENT_SOURCE } from "@noobot/attachment-protocol";
import { isModelOutputArtifactContentBlock } from "@noobot/model-protocol";
import {
  getSystemRuntimeFromRuntime,
  resolveRuntimeTurnScopeId,
} from "../../context/agent-context-accessor.js";
import { text } from "@noobot/shared/value";

export function extractGeneratedMediaCandidates(aiContent) {
  if (!Array.isArray(aiContent)) return [];
  const mediaCandidates = [];
  let mediaIndex = 0;
  for (const contentPart of aiContent) {
    if (!isModelOutputArtifactContentBlock(contentPart)) continue;
    const partType = text(contentPart?.type).toLowerCase();

    const imageUrl = text(contentPart?.image_url?.url);
    const videoUrl = text(contentPart?.video_url?.url);
    const directUrl = text(contentPart?.url);
    const sourceType = text(contentPart?.source?.type).toLowerCase();
    const sourceMediaType = text(contentPart?.source?.media_type).toLowerCase();
    const sourceData = text(contentPart?.source?.data);
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
  const normalizedUrl = text(url);
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
  const systemRuntime = getSystemRuntimeFromRuntime(runtime);
  const turnScopeId = resolveRuntimeTurnScopeId(runtime);
  const resolvedDialogProcessId = normalizeDialogProcessId(dialogProcessId);
  const { sessionId } = systemRuntime;
  return { turnScopeId, dialogProcessId: resolvedDialogProcessId, sessionId };
}

export async function persistModelGeneratedArtifacts({
  aiContent,
  runtime = {},
  eventListener = null,
  dialogProcessId = "",
  modelMessageId = "",
}) {
  const attachmentService = runtime?.attachmentService || null;
  const userId = text(runtime?.systemRuntime?.userId);
  if (!attachmentService || !userId) return [];
  const fetchImpl = runtime.sharedTools.fetch;
  const localMediaCandidates = extractGeneratedMediaCandidates(aiContent);
  const remoteMediaCandidates = [];
  if (Array.isArray(aiContent)) {
    let remoteMediaIndex = 0;

    const fetchPromises = [];
    for (const contentPart of aiContent) {
      if (!isModelOutputArtifactContentBlock(contentPart)) continue;
      const imageUrl = text(contentPart?.image_url?.url);
      const videoUrl = text(contentPart?.video_url?.url);
      const directUrl = text(contentPart?.url);
      const remoteUrl = imageUrl || videoUrl || directUrl;
      if (!/^https?:\/\//i.test(remoteUrl)) continue;
      remoteMediaIndex += 1;

      fetchPromises.push(fetchRemoteMediaArtifact(remoteUrl, fetchImpl, remoteMediaIndex, runtime));
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
  if (!text(modelMessageId) || !ownership.sessionId || !ownership.turnScopeId) {
    throw new Error("model_generated_artifact_ownership_incomplete");
  }
  const attachmentRecords = await attachmentService.ingestGeneratedArtifacts({
    userId,
    sessionId: ownership.sessionId,
    attachmentSource: ATTACHMENT_SOURCE.MODEL,
    generationSource: "llm_output",
    turnScope: {
      sessionId: ownership.sessionId,
      turnScopeId: ownership.turnScopeId,
    },
    turnScopeId: ownership.turnScopeId,
    dialogProcessId: ownership.dialogProcessId,
    owner: { type: "model", id: String(modelMessageId).trim() },
    artifacts: allMediaCandidates,
  });
  emitEvent(eventListener, "model_generated_attachments_saved", {
    dialogProcessId: normalizeDialogProcessId(dialogProcessId),
    count: attachmentRecords.length,
    attachments: attachmentRecords,
  });
  return attachmentRecords;
}
