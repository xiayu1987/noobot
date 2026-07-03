/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { parseDataUrl } from "../../utils/mime-utils.js";
import { TIME_THRESHOLDS } from "@noobot/shared/time-thresholds";

const DEFAULT_IMAGE_ASYNC_POLL_INTERVAL_MS = TIME_THRESHOLDS.tools.imagesAsyncPollIntervalMs;
const DEFAULT_IMAGE_ASYNC_TIMEOUT_MS = TIME_THRESHOLDS.tools.imagesAsyncTimeoutMs;
const IMAGES_ASYNC_RATIO_SIZE_PATTERN = /^(auto|\d+(?:\.\d+)?:\d+(?:\.\d+)?)$/i;
const IMAGES_ASYNC_DEFAULT_RESOLUTION = "1K";
const IMAGES_ASYNC_HTTP_STATUS_HINTS = Object.freeze({
  400: "参数错误，如不支持的 size 格式",
  401: "API Key 无效",
  402: "余额不足",
  404: "任务不存在或无权访问；任务查询只能查询自己创建的任务",
  503: "无可用渠道",
});

function isImagesAsyncRatioSize(imageSize = "") {
  return IMAGES_ASYNC_RATIO_SIZE_PATTERN.test(String(imageSize || "").trim());
}

function normalizeImageGenerationCount(value = 1) {
  const count = Math.floor(Number(value || 1));
  if (!Number.isFinite(count)) return 1;
  return Math.min(10, Math.max(1, count));
}

function normalizeImagesAsyncGenerationCount(value = 1, modelName = "") {
  const normalizedCount = normalizeImageGenerationCount(value);
  const normalizedModelName = String(modelName || "").trim().toLowerCase();
  if (normalizedModelName === "gpt-image-2-beta") return 1;
  return normalizedCount;
}

function resolveImagesAsyncResolution({ imageSize = "", resolution = "" } = {}) {
  const normalizedResolution = String(resolution || "").trim();
  if (normalizedResolution) return normalizedResolution;
  return isImagesAsyncRatioSize(imageSize) ? IMAGES_ASYNC_DEFAULT_RESOLUTION : "";
}

function extractImagesAsyncTaskId(payload = {}) {
  const payloadData = payload?.data && typeof payload.data === "object" ? payload.data : null;
  const data = Array.isArray(payloadData) ? payloadData : payloadData ? [payloadData] : [];
  const firstDataItem = data.find((item) => item && typeof item === "object") || {};
  return String(
    payload?.id ||
      payload?.task_id ||
      payload?.taskId ||
      firstDataItem?.id ||
      firstDataItem?.task_id ||
      firstDataItem?.taskId ||
      "",
  ).trim();
}

function unwrapImagesAsyncPayload(payload = {}) {
  const source = payload && typeof payload === "object" ? payload : {};
  const nestedData =
    source?.data && typeof source.data === "object" && !Array.isArray(source.data)
      ? source.data
      : null;
  const nestedPayload =
    source?.payload && typeof source.payload === "object" && !Array.isArray(source.payload)
      ? source.payload
      : null;
  const nestedResult =
    source?.result && typeof source.result === "object" && !Array.isArray(source.result)
      ? source.result
      : null;
  return {
    ...source,
    ...(nestedData || {}),
    ...(nestedPayload || {}),
    ...(nestedResult || {}),
  };
}

function normalizeImagesAsyncTaskPayload(payload = {}) {
  const source = unwrapImagesAsyncPayload(payload || {});
  const sourceData = source?.data && typeof source.data === "object" ? source.data : null;
  const data = Array.isArray(sourceData) ? sourceData : sourceData ? [sourceData] : [];
  const firstDataItem = data.find((item) => item && typeof item === "object") || {};
  return {
    ...source,
    ...(firstDataItem && typeof firstDataItem === "object" ? firstDataItem : {}),
    result_data:
      source?.result_data ||
      source?.resultData ||
      source?.images ||
      source?.output ||
      firstDataItem?.result_data ||
      firstDataItem?.resultData ||
      firstDataItem?.images ||
      firstDataItem?.output ||
      [],
  };
}

function normalizeGeneratedImageBase64(value = "") {
  const normalized = String(value || "").trim();
  if (!normalized.startsWith("data:image/")) return normalized;
  const parsed = parseDataUrl(normalized);
  return parsed?.contentBase64 || normalized;
}

function taskPayloadToImageArtifacts(taskPayload = {}) {
  const normalizedTask = normalizeImagesAsyncTaskPayload(taskPayload || {});
  const resultData = Array.isArray(normalizedTask?.result_data)
    ? normalizedTask.result_data
    : [];
  return resultData
    .map((item = {}, index) => ({
      fileName: `generated_image_${index + 1}.png`,
      b64Json: normalizeGeneratedImageBase64(
        item?.b64_json ||
          item?.image_base64 ||
          item?.base64 ||
          item?.data ||
          "",
      ).trim(),
      url: String(item?.url || item?.image_url || "").trim(),
    }))
    .filter((item) => item.b64Json || item.url);
}

function normalizeBaseUrl(baseUrl = "") {
  return String(baseUrl || "").trim().replace(/\/+$/, "");
}

function buildApiUrl(baseUrl = "", path = "") {
  const normalizedBaseUrl = normalizeBaseUrl(baseUrl);
  const normalizedPath = String(path || "").trim();
  if (!normalizedBaseUrl) return normalizedPath;
  if (normalizedBaseUrl.endsWith("/v1") && normalizedPath.startsWith("/v1/")) {
    return `${normalizedBaseUrl}${normalizedPath.slice(3)}`;
  }
  return `${normalizedBaseUrl}${normalizedPath}`;
}

export function normalizeImagesAsyncBaseUrl(baseUrl = "") {
  const normalizedBaseUrl = normalizeBaseUrl(baseUrl);
  if (!normalizedBaseUrl) return "";
  try {
    const url = new URL(normalizedBaseUrl);
    const pathname = url.pathname.replace(/\/+$/, "");
    if (/\/chatgpt\/v1$/i.test(pathname)) {
      url.pathname = pathname.replace(/\/chatgpt\/v1$/i, "/v1");
      url.search = "";
      url.hash = "";
      return url.toString().replace(/\/+$/, "");
    }
  } catch {
    if (/\/chatgpt\/v1$/i.test(normalizedBaseUrl)) {
      return normalizedBaseUrl.replace(/\/chatgpt\/v1$/i, "/v1");
    }
  }
  return normalizedBaseUrl;
}

function describeImagesAsyncHttpStatus(status = 0) {
  return IMAGES_ASYNC_HTTP_STATUS_HINTS[Number(status || 0)] || "";
}

async function requestJson({ fetchImpl, url, method = "GET", headers = {}, body = null } = {}) {
  let response = null;
  try {
    response = await fetchImpl(url, {
      method,
      headers: {
        ...headers,
        ...(body ? { "Content-Type": "application/json" } : {}),
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
  } catch (error) {
    error.requestUrl = String(url || "").trim();
    error.requestMethod = String(method || "GET").trim().toUpperCase();
    throw error;
  }
  const responseText = await response.text();
  let payload = {};
  try {
    payload = responseText ? JSON.parse(responseText) : {};
  } catch {
    payload = { message: responseText };
  }
  if (!response?.ok) {
    const message = String(payload?.error?.message || payload?.message || payload?.error || responseText || "").trim();
    const statusHint = describeImagesAsyncHttpStatus(response?.status);
    const error = new Error(
      [message || `HTTP ${response?.status || 500}`, statusHint].filter(Boolean).join("；"),
    );
    error.status = response?.status;
    error.payload = payload;
    error.requestUrl = String(url || "").trim();
    error.requestMethod = String(method || "GET").trim().toUpperCase();
    if (statusHint) error.statusHint = statusHint;
    throw error;
  }
  return payload;
}

function sleep(ms = 0) {
  return new Promise((resolve) => setTimeout(resolve, Math.max(0, Number(ms || 0))));
}

export async function generateWithImagesAsyncApi({
  fetchImpl,
  baseUrl = "",
  apiKey = "",
  modelName,
  generationContent,
  imageSize,
  resolution = "",
  n = 1,
  quality = "",
  imageUrls = [],
  taskIdMissingMessage = "Task id missing",
  taskFailedMessage = "Task failed",
  taskTimeoutMessage = "Task timed out",
  taskTimeoutMessageBuilder = null,
} = {}) {
  if (typeof fetchImpl !== "function") {
    throw new Error("fetch unavailable");
  }
  const normalizedBaseUrl = normalizeImagesAsyncBaseUrl(baseUrl);
  const taskCreateUrl = buildApiUrl(normalizedBaseUrl, "/v1/images/generations");
  const headers = {
    Authorization: `Bearer ${String(apiKey || "").trim()}`,
  };
  const normalizedSize = String(imageSize || "1:1").trim() || "1:1";
  const normalizedResolution = resolveImagesAsyncResolution({
    imageSize: normalizedSize,
    resolution,
  });
  const requestBody = {
    model: String(modelName || "").trim(),
    prompt: String(generationContent || "").trim(),
    size: normalizedSize,
    ...(normalizedResolution ? { resolution: normalizedResolution } : {}),
    n: normalizeImagesAsyncGenerationCount(n, modelName),
    ...(String(quality || "").trim() ? { quality: String(quality || "").trim() } : {}),
    ...(imageUrls.length ? { image_urls: imageUrls } : {}),
  };
  const createdTask = await requestJson({
    fetchImpl,
    url: taskCreateUrl,
    method: "POST",
    headers,
    body: requestBody,
  });
  const taskId = extractImagesAsyncTaskId(createdTask);
  if (!taskId) {
    const error = new Error(taskIdMissingMessage);
    error.apiTypeSwitchHint = true;
    throw error;
  }
  const startedAtMs = Date.now();
  let latestTask = null;
  const taskUrl = buildApiUrl(normalizedBaseUrl, `/v1/tasks/${encodeURIComponent(taskId)}`);
  while (Date.now() - startedAtMs < DEFAULT_IMAGE_ASYNC_TIMEOUT_MS) {
    latestTask = await requestJson({
      fetchImpl,
      url: taskUrl,
      method: "GET",
      headers,
    });
    const normalizedTask = normalizeImagesAsyncTaskPayload(latestTask || {});
    const status = String(normalizedTask?.status || "").trim().toLowerCase();
    if (status === "completed") {
      const imageArtifacts = taskPayloadToImageArtifacts(normalizedTask);
      return {
        taskId,
        imageArtifacts,
        rawText: "",
        rawTask: normalizedTask,
      };
    }
    if (status === "failed") {
      const error = new Error(String(normalizedTask?.error || normalizedTask?.message || taskFailedMessage));
      error.apiTypeSwitchHint = true;
      throw error;
    }
    await sleep(DEFAULT_IMAGE_ASYNC_POLL_INTERVAL_MS);
  }
  const timeoutMessage = typeof taskTimeoutMessageBuilder === "function"
    ? taskTimeoutMessageBuilder(taskId)
    : taskTimeoutMessage;
  const timeoutError = new Error(String(timeoutMessage || "Task timed out"));
  timeoutError.apiTypeSwitchHint = true;
  throw timeoutError;
}
