/* Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import {
  bindOpenAiCompatibleTools,
  createOpenAiCompatibleClient,
  resolveUseResponsesApi,
} from "./openai-compatible-adapter.js";
import { classifyTransportError } from "../policies/default-retry-policy.js";
import { executeOpenAiOperation } from "./openai-capability-adapter.js";

function normalizeAudioFormat(mimeType = "") {
  return ["audio/wav", "audio/x-wav"].includes(String(mimeType).toLowerCase()) ? "wav" : "mp3";
}

export function mapDashScopeMultimodalAttachment(attachment = {}) {
  const mimeType = String(attachment.mimeType || "application/octet-stream").trim();
  const data = String(attachment.data || "").trim();
  const normalizedMimeType = mimeType.toLowerCase();
  if (normalizedMimeType.startsWith("image/")) return { type: "input_image", image_url: data };
  if (normalizedMimeType.startsWith("audio/")) {
    return {
      type: "input_audio",
      input_audio: { data, format: normalizeAudioFormat(normalizedMimeType) },
    };
  }
  if (normalizedMimeType.startsWith("video/")) return { type: "video", video: data };
  return {
    type: "input_file",
    file_data: data,
    filename: String(attachment.fileName || "").trim() || undefined,
  };
}

export function mapDashScopeChatMultimodalAttachment(attachment = {}) {
  const mimeType = String(attachment.mimeType || "application/octet-stream")
    .trim()
    .toLowerCase();
  const data = String(attachment.data || "").trim();
  if (mimeType.startsWith("image/")) return { type: "image_url", image_url: { url: data } };
  if (mimeType.startsWith("audio/")) return { type: "audio_url", audio_url: { url: data } };
  if (mimeType.startsWith("video/")) return { type: "video_url", video_url: { url: data } };
  throw new TypeError(`DashScope multimodal chat input does not support MIME type: ${mimeType}`);
}

export function createDashScopeClient(input = {}) {
  const modelSpec = input.modelSpec || {};
  const headers = {
    ...(input.headers || {}),
    ...(resolveUseResponsesApi(modelSpec) ? { "x-dashscope-session-cache": "enable" } : {}),
  };
  return createOpenAiCompatibleClient({ ...input, headers });
}

export const dashscopeAdapter = Object.freeze({
  id: "dashscope",
  formats: Object.freeze(["dashscope"]),
  classifyError: classifyTransportError,
  createClient(input) {
    return createDashScopeClient(input);
  },
  bindTools({ client, tools, toolOptions, invokeOptions }) {
    return bindOpenAiCompatibleTools(client, tools, toolOptions, invokeOptions);
  },
  executeOperation(input) {
    return executeOpenAiOperation({
      ...input,
      multimodalParseTransport: "chat_completions",
      mapMultimodalAttachment: mapDashScopeChatMultimodalAttachment,
    });
  },
});
