/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { mkdir, readFile } from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { DynamicStructuredTool } from "@langchain/core/tools";
import { z } from "zod";
import { materializeTextForToolResult } from "../../semantic-transfer/index.js";
import { recoverableToolError } from "../../error/index.js";
import {
  invokeModelWithTextAndAttachments,
  resolveModelSpecByAlias,
} from "../../model/index.js";
import { getRuntimeFromAgentContext } from "../../context/agent-context-accessor.js";
import { assertAndResolveUserWorkspaceFilePath } from "../core/check-tool-input.js";
import { toToolJsonResult } from "../core/tool-json-result.js";
import { tTool } from "../core/tool-i18n.js";
import { ERROR_CODE } from "../../error/constants.js";
import {
  ARTIFACT_GENERATION_SOURCE,
  TOOL_ATTACHMENT_SOURCE,
  TOOL_NAME,
  TOOL_RESULT_STATUS,
} from "../constants/index.js";
import {
  AUDIO_EXTENSION_TO_MIME,
  AUDIO_EXTENSIONS,
  DEFAULT_MIME_TYPE,
  IMAGE_EXTENSION_TO_MIME,
  IMAGE_EXTENSIONS,
  MIME_TYPE,
  VIDEO_EXTENSION_TO_MIME,
} from "./file-extension-constants.js";
const FFPROBE_AMBIGUOUS_EXTENSIONS = new Set([".webm", ".ogg", ".mkv"]);
const MODEL_READY_AUDIO_EXTENSIONS = new Set([".wav", ".mp3"]);
function normalizeMediaInputPath(rawFilePath = "") {
  const normalized = String(rawFilePath || "").trim();
  if (!normalized) return "";
  if (!normalized.startsWith("file://")) return normalized;
  try {
    return fileURLToPath(normalized);
  } catch {
    return normalized;
  }
}

function resolveMediaInputPathFromAttachmentMetas(filePath = "", agentContext = {}) {
  const normalizedInputPath = normalizeMediaInputPath(filePath);
  const runtime = getRuntimeFromAgentContext(agentContext);
  const runtimeAttachmentMetas = Array.isArray(runtime?.attachmentMetas)
    ? runtime.attachmentMetas
    : [];
  if (!normalizedInputPath || !runtimeAttachmentMetas.length) {
    return {
      resolvedInputPath: normalizedInputPath,
      sourceAttachmentMeta: null,
    };
  }
  const inputBaseName = path.basename(normalizedInputPath);
  const inputAttachmentId = String(inputBaseName || "").split(".")[0];
  const matchedMeta = runtimeAttachmentMetas.find((attachmentItem) => {
    const metaPath = normalizeMediaInputPath(String(attachmentItem?.path || ""));
    if (!metaPath) return false;
    const metaBaseName = path.basename(metaPath);
    const metaAttachmentId = String(attachmentItem?.attachmentId || "").trim();
    return (
      (inputBaseName && metaBaseName === inputBaseName) ||
      (inputAttachmentId && metaAttachmentId && inputAttachmentId === metaAttachmentId)
    );
  });
  const matchedMetaPath = normalizeMediaInputPath(String(matchedMeta?.path || ""));
  return {
    resolvedInputPath: matchedMetaPath || normalizedInputPath,
    sourceAttachmentMeta: matchedMeta || null,
  };
}

function resolveMimeTypeByPath(filePath = "", preferredMediaType = "") {
  const extension = path.extname(String(filePath || "")).toLowerCase();
  const normalizedPreferredMediaType = String(preferredMediaType || "")
    .trim()
    .toLowerCase();
  if (normalizedPreferredMediaType === "audio") {
    return AUDIO_EXTENSION_TO_MIME[extension] || DEFAULT_MIME_TYPE;
  }
  if (normalizedPreferredMediaType === "video") {
    return VIDEO_EXTENSION_TO_MIME[extension] || DEFAULT_MIME_TYPE;
  }
  return (
    IMAGE_EXTENSION_TO_MIME[extension] ||
    AUDIO_EXTENSION_TO_MIME[extension] ||
    VIDEO_EXTENSION_TO_MIME[extension] ||
    DEFAULT_MIME_TYPE
  );
}

async function toDataUrl(filePath = "", preferredMediaType = "") {
  const mimeType = resolveMimeTypeByPath(filePath, preferredMediaType);
  const contentBase64 = (await readFile(filePath)).toString("base64");
  return `data:${mimeType};base64,${contentBase64}`;
}

function resolveAttachmentAliasByType({
  globalConfig,
  userConfig,
  mediaType = "image",
}) {
  const normalizedMediaType = String(mediaType || "image").trim() || "image";
  return (
    userConfig?.attachments?.attachment_models?.[normalizedMediaType] ||
    globalConfig?.attachments?.attachment_models?.[normalizedMediaType] ||
    ""
  );
}

function resolveMediaTypeByPath(filePath = "") {
  const extension = path.extname(String(filePath || "")).toLowerCase();
  if (IMAGE_EXTENSIONS.has(extension)) return "image";
  if (VIDEO_EXTENSION_TO_MIME[extension]) return "video";
  if (AUDIO_EXTENSIONS.has(extension)) return "audio";
  return "";
}

function runFfprobe(filePath = "") {
  return new Promise((resolve, reject) => {
    const ffprobeProcess = spawn(
      "ffprobe",
      [
        "-v",
        "error",
        "-show_streams",
        "-print_format",
        "json",
        String(filePath || ""),
      ],
      { stdio: ["ignore", "pipe", "pipe"] },
    );
    let stdoutText = "";
    let stderrText = "";
    ffprobeProcess.stdout.on("data", (chunk) => {
      stdoutText += String(chunk || "");
    });
    ffprobeProcess.stderr.on("data", (chunk) => {
      stderrText += String(chunk || "");
    });
    ffprobeProcess.on("error", (error) => reject(error));
    ffprobeProcess.on("close", (exitCode) => {
      if (exitCode !== 0) {
        reject(new Error(stderrText.trim() || `ffprobe exited with code ${exitCode}`));
        return;
      }
      resolve(stdoutText);
    });
  });
}

async function resolveMediaTypeByPathWithProbe(filePath = "") {
  const normalizedFilePath = String(filePath || "").trim();
  const extension = path.extname(normalizedFilePath).toLowerCase();
  const extensionResolvedType = resolveMediaTypeByPath(normalizedFilePath);
  if (!FFPROBE_AMBIGUOUS_EXTENSIONS.has(extension)) {
    return extensionResolvedType;
  }
  try {
    const ffprobeJsonText = await runFfprobe(normalizedFilePath);
    const ffprobePayload = JSON.parse(ffprobeJsonText || "{}");
    const streamList = Array.isArray(ffprobePayload?.streams)
      ? ffprobePayload.streams
      : [];
    const hasVideoStream = streamList.some(
      (streamItem) => String(streamItem?.codec_type || "").trim().toLowerCase() === "video",
    );
    if (hasVideoStream) return "video";
    const hasAudioStream = streamList.some(
      (streamItem) => String(streamItem?.codec_type || "").trim().toLowerCase() === "audio",
    );
    if (hasAudioStream) return "audio";
    return extensionResolvedType;
  } catch {
    return extensionResolvedType;
  }
}

function runFfmpeg(args = []) {
  return new Promise((resolve, reject) => {
    const ffmpegProcess = spawn("ffmpeg", args, {
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stderrText = "";
    ffmpegProcess.stderr.on("data", (chunk) => {
      stderrText += String(chunk || "");
    });
    ffmpegProcess.on("error", (error) => {
      reject(error);
    });
    ffmpegProcess.on("close", (exitCode) => {
      if (exitCode === 0) {
        resolve();
        return;
      }
      reject(new Error(stderrText.trim() || `ffmpeg exited with code ${exitCode}`));
    });
  });
}

async function ensureAudioFileForModel(inputFile = "", outputDirectory = "") {
  await mkdir(outputDirectory, { recursive: true });
  const extension = path.extname(String(inputFile || "")).toLowerCase();
  if (MODEL_READY_AUDIO_EXTENSIONS.has(extension)) {
    return {
      filePath: inputFile,
      format: extension.replace(/^\./, ""),
    };
  }
  const outputFilePath = path.join(outputDirectory, `${randomUUID()}.mp3`);
  await runFfmpeg([
    "-y",
    "-i",
    inputFile,
    "-vn",
    "-acodec",
    "libmp3lame",
    "-ar",
    "16000",
    outputFilePath,
  ]);
  return { filePath: outputFilePath, format: "mp3" };
}

async function ensureVideoFileForModel(inputFile = "", outputDirectory = "") {
  await mkdir(outputDirectory, { recursive: true });
  const extension = path.extname(String(inputFile || "")).toLowerCase();
  if (extension === ".mp4") {
    return { filePath: inputFile, mimeType: MIME_TYPE.VIDEO_MP4 };
  }
  const outputFilePath = path.join(outputDirectory, `${randomUUID()}.mp4`);
  await runFfmpeg([
    "-y",
    "-i",
    inputFile,
    "-c:v",
    "libx264",
    "-c:a",
    "aac",
    "-movflags",
    "+faststart",
    outputFilePath,
  ]);
  return { filePath: outputFilePath, mimeType: MIME_TYPE.VIDEO_MP4 };
}

function resolveMedia2DataPromptByMediaType({
  runtime,
  mediaType = "image",
  prompt = "",
}) {
  const customPrompt = String(prompt || "").trim();
  if (customPrompt) return customPrompt;
  if (mediaType === "audio") {
    return tTool(runtime, "tools.media2data.extractAudioPrompt");
  }
  if (mediaType === "video") {
    return tTool(runtime, "tools.media2data.extractVideoPrompt");
  }
  return tTool(runtime, "tools.media2data.extractImagePrompt");
}

function sanitizeArtifactBaseName(input = "", fallback = "media2data_result") {
  const normalized = String(input || "").trim();
  if (!normalized) return fallback;
  return normalized.replace(/[^\w.-]+/g, "_");
}

async function persistMedia2DataTextAttachment({
  runtime = {},
  agentContext = null,
  inputFile = "",
  mediaType = "",
  text = "",
}) {
  const inputBaseName = sanitizeArtifactBaseName(
    path.basename(String(inputFile || "").trim(), path.extname(String(inputFile || "").trim())),
  );
  const mediaTypeSuffix = sanitizeArtifactBaseName(mediaType || "media", "media");
  const artifactName = `${inputBaseName}.media2data.${mediaTypeSuffix}.md`;
  const materialized = await materializeTextForToolResult({
    runtime,
    agentContext,
    text,
    name: artifactName,
    mimeType: MIME_TYPE.TEXT_MARKDOWN,
    attachmentSource: TOOL_ATTACHMENT_SOURCE.MODEL,
    generationSource: ARTIFACT_GENERATION_SOURCE.MEDIA_TO_DATA_TOOL,
    source: "tool",
    reason: ARTIFACT_GENERATION_SOURCE.MEDIA_TO_DATA_TOOL,
    alwaysPersist: true,
    producer: { type: "tool", name: TOOL_NAME.MEDIA_TO_DATA },
    meta: { mediaType, inputFile },
  });
  return {
    attachmentMetas: materialized.attachmentMetas,
    transferEnvelope: materialized.transferEnvelope,
    transferEnvelopes: materialized.transferEnvelopes,
    resultFields: materialized.resultFields,
  };
}

async function backwriteParsedResultToSourceAttachment({
  runtime = {},
  sourceAttachmentMeta = null,
  parsedAttachmentMeta = null,
}) {
  const sourceAttachmentId = String(sourceAttachmentMeta?.attachmentId || "").trim();
  if (!sourceAttachmentId || !parsedAttachmentMeta) return null;
  const attachmentService = runtime?.attachmentService || null;
  const userId = String(runtime?.userId || "").trim();
  if (!attachmentService || !userId) return null;
  try {
    const updatedSourceAttachment = await attachmentService.linkParsedResultToAttachment({
      userId,
      sourceAttachmentId,
      parsedAttachmentMeta,
      toolName: TOOL_NAME.MEDIA_TO_DATA,
      sourceSessionId: String(sourceAttachmentMeta?.sessionId || "").trim(),
      sourceAttachmentSource: String(sourceAttachmentMeta?.attachmentSource || "").trim(),
      sourceAttachmentPath: String(sourceAttachmentMeta?.path || "").trim(),
    });
    if (Array.isArray(runtime?.attachmentMetas)) {
      const sourceAttachmentIndex = runtime.attachmentMetas.findIndex(
        (item) => String(item?.attachmentId || "").trim() === sourceAttachmentId,
      );
      if (sourceAttachmentIndex >= 0) {
        runtime.attachmentMetas[sourceAttachmentIndex] = {
          ...(runtime.attachmentMetas[sourceAttachmentIndex] || {}),
          ...(updatedSourceAttachment || {}),
        };
      }
    }
    return updatedSourceAttachment;
  } catch {
    return null;
  }
}

export function createMedia2DataTool({ agentContext }) {
  const runtime = getRuntimeFromAgentContext(agentContext);
  const globalConfig = runtime.globalConfig || {};
  const userConfig = runtime.userConfig || {};
  const basePath =
    agentContext?.environment?.workspace?.basePath || runtime.basePath || "";
  if (!basePath) return [];

  const media2dataTool = new DynamicStructuredTool({
    name: TOOL_NAME.MEDIA_TO_DATA,
    description: tTool(runtime, "tools.media2data.description"),
    schema: z.object({
      filePath: z.string().describe(tTool(runtime, "tools.media2data.fieldFilePath")),
      prompt: z
        .string()
        .optional()
        .describe(tTool(runtime, "tools.media2data.fieldPrompt")),
    }),
    func: async ({ filePath, prompt }) => {
      const { resolvedInputPath: resolvedInputHintPath, sourceAttachmentMeta } =
        resolveMediaInputPathFromAttachmentMetas(
        filePath,
        agentContext,
      );
      const inputFile = await assertAndResolveUserWorkspaceFilePath({
        filePath: resolvedInputHintPath,
        agentContext,
        fieldName: "filePath",
        mustExist: true,
      });
      const mediaType = await resolveMediaTypeByPathWithProbe(inputFile);
      if (!mediaType) {
        throw recoverableToolError(
          tTool(runtime, "tools.media2data.unsupportedMediaFileType"),
          {
            code: ERROR_CODE.RECOVERABLE_UNSUPPORTED_MEDIA_FILE_TYPE,
            details: { input: inputFile },
          },
        );
      }

      const outputDirectory = path.join(
        basePath,
        "runtime",
        "workspace",
        ".media2data",
        "media-transcoded",
      );
      const modelAlias = resolveAttachmentAliasByType({
        globalConfig,
        userConfig,
        mediaType,
      });
      const modelSpec = resolveModelSpecByAlias({
        alias: modelAlias,
        globalConfig,
        userConfig,
        fallbackToDefault: true,
      });
      const userPrompt = resolveMedia2DataPromptByMediaType({
        runtime,
        mediaType,
        prompt,
      });

      let attachmentPayload = null;
      if (mediaType === "audio") {
        const preparedAudioFile = await ensureAudioFileForModel(inputFile, outputDirectory);
        const contentBase64 = (
          await readFile(preparedAudioFile.filePath)
        ).toString("base64");
        const audioMimeType =
          preparedAudioFile.format === "wav"
            ? MIME_TYPE.AUDIO_WAV
            : MIME_TYPE.AUDIO_MPEG;
        attachmentPayload = {
          type: audioMimeType,
          mimeType: audioMimeType,
          data: contentBase64,
        };
      } else if (mediaType === "video") {
        const preparedVideoFile = await ensureVideoFileForModel(inputFile, outputDirectory);
        attachmentPayload = {
          type: preparedVideoFile.mimeType,
          mimeType: preparedVideoFile.mimeType,
          data: await toDataUrl(preparedVideoFile.filePath, "video"),
        };
      } else {
        const imageMimeType = resolveMimeTypeByPath(inputFile, "image");
        attachmentPayload = {
          type: imageMimeType,
          mimeType: imageMimeType,
          data: await toDataUrl(inputFile, "image"),
        };
      }

      const modelResult = await invokeModelWithTextAndAttachments({
        modelName: modelSpec?.alias || modelSpec?.model,
        text: userPrompt,
        attachments: [attachmentPayload],
        globalConfig,
        userConfig,
        streaming: false,
      });
      const extractedText = String(modelResult.text || "");
      const persistedOutput = await persistMedia2DataTextAttachment({
        runtime,
        agentContext,
        inputFile,
        mediaType,
        text: extractedText,
      });
      const attachmentMetas = Array.isArray(persistedOutput?.attachmentMetas)
        ? persistedOutput.attachmentMetas
        : [];
      const updatedSourceAttachment = await backwriteParsedResultToSourceAttachment({
        runtime,
        sourceAttachmentMeta,
        parsedAttachmentMeta: attachmentMetas[0] || null,
      });
      return toToolJsonResult(
        TOOL_NAME.MEDIA_TO_DATA,
        {
          ok: true,
          status: TOOL_RESULT_STATUS.COMPLETED,
          message: "内容已通过 semantic-transfer 保存到附件；未超过限制时同时直接返回 text，超过限制时返回预览。",
          mode: `${mediaType}_model`,
          input: inputFile,
          ...persistedOutput.resultFields,
          model: {
            alias: modelSpec?.alias || "",
            name: modelSpec?.model || "",
          },
          summary: {
            media_type: mediaType,
            parsed_from_attachment_id: String(sourceAttachmentMeta?.attachmentId || ""),
            parsed_result_path: String(attachmentMetas?.[0]?.path || ""),
            source_attachment_backwritten: Boolean(updatedSourceAttachment),
            saved_attachment_count: attachmentMetas.length,
            text_length: extractedText.length,
          },
        },
        true,
      );
    },
  });

  return [media2dataTool];
}
