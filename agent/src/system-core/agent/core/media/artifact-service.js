/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { logger } from "../../../tracking/index.js";
import { emitEvent } from "../../../event/index.js";
import {
  appendAttachmentMetasToRuntimeAndTurn,
  mapAttachmentRecordsToMetas,
} from "../../../attach/index.js";
import { tEngine } from "../i18n-adapter.js";
import {
  parseDataUrl,
  sanitizeGeneratedArtifactName,
} from "../../../utils/mime-utils.js";
import { safeNum } from "../../../utils/shared-utils.js";
import { MIME_TYPE } from "../../../constants/index.js";

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

export async function persistModelGeneratedArtifacts({
  aiContent,
  runtime = {},
  eventListener = null,
  dialogProcessId = "",
  turnMessageStore = null,
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
    
    // Use Promise.all to fetch remote media concurrently
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
  const savedRecords = await attachmentService.ingestGeneratedArtifacts({
    userId,
    sessionId: String(
      runtime?.systemRuntime?.sessionId ||
        runtime?.systemRuntime?.rootSessionId ||
        "",
    ).trim(),
    attachmentSource: "model",
    artifacts: allMediaCandidates,
    generationSource: "llm_output",
  });
  const attachmentMetas = mapAttachmentRecordsToMetas(savedRecords, {
    fallbackMimeType: MIME_TYPE.APPLICATION_OCTET_STREAM,
    fallbackGenerationSource: "llm_output",
    userId,
  });
  if (!attachmentMetas.length) return [];
  appendAttachmentMetasToRuntimeAndTurn({
    runtime,
    turnMessageStore,
    attachmentMetas,
  });
  emitEvent(eventListener, "model_generated_attachments_saved", {
    dialogProcessId: String(dialogProcessId || ""),
    count: attachmentMetas.length,
  });
  return attachmentMetas;
}

export function extractAttachmentMetasFromToolResult(toolName = "", toolResultText = "") {
  void toolName;
  const normalizedToolResultText = String(toolResultText || "").trim();
  if (!normalizedToolResultText) return [];
  try {
    const parsedResult = JSON.parse(normalizedToolResultText);
    const attachmentMetas = Array.isArray(parsedResult?.attachmentMetas)
      ? parsedResult.attachmentMetas
      : [];
    if (!attachmentMetas.length) return [];
    return attachmentMetas.map((attachmentItem) => ({
      attachmentId: String(attachmentItem?.attachmentId || "").trim(),
      name: String(attachmentItem?.name || "").trim(),
      mimeType: String(
        attachmentItem?.mimeType || MIME_TYPE.APPLICATION_OCTET_STREAM,
      ).trim(),
      size: safeNum(attachmentItem?.size),
      sessionId: String(attachmentItem?.sessionId || "").trim(),
      attachmentSource: String(attachmentItem?.attachmentSource || "").trim(),
      path: String(attachmentItem?.path || "").trim(),
      relativePath: String(attachmentItem?.relativePath || "").trim(),
      generatedByModel: attachmentItem?.generatedByModel === true,
      generationSource: String(attachmentItem?.generationSource || "").trim(),
    }));
  } catch {
    return [];
  }
}
