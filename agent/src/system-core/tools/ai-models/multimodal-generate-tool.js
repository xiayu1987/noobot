/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { DynamicStructuredTool } from "@langchain/core/tools";
import OpenAI from "openai";
import { z } from "zod";
import { mergeConfig } from "../../config/index.js";
import { mapAttachmentRecordsToMetas } from "../../attach/meta-ops.js";
import {
  resolveDefaultModelSpec,
  resolveModelSpecByName,
} from "../../model/index.js";
import { toToolJsonResult } from "../core/tool-json-result.js";
import { tTool } from "../core/tool-i18n.js";
import { parseDataUrl, sanitizeGeneratedArtifactName } from "../../utils/mime-utils.js";
import { recoverableToolError } from "../../error/index.js";
import { ERROR_CODE } from "../../error/constants.js";
import { MIME_TYPE } from "../../constants/index.js";
import { resolveParentSessionId } from "../../context/parent-session-id-resolver.js";
import {
  buildPluginModelHeaders,
  MODEL_NAME_HEADER_KEY,
  PARENT_SESSION_HEADER_KEY,
} from "../../model/headers/plugin-headers.js";
import {
  ARTIFACT_GENERATION_SOURCE,
  TOOL_ATTACHMENT_SOURCE,
  TOOL_CALL_MODE,
  IMAGE_GENERATION_API_TYPE,
  TOOL_NAME,
  TOOL_RESULT_STATUS,
} from "../constants/index.js";

const MULTIMODAL_FLOW_NAME = "agent.multimodal_generate";
const MULTIMODAL_PURPOSE_NAME = "multimodal_generate";
const MULTIMODAL_DOMAIN_NAME = "tool";
const DEFAULT_IMAGE_ASYNC_POLL_INTERVAL_MS = 5000;
const DEFAULT_IMAGE_ASYNC_TIMEOUT_MS = 180000;
const WEBSOCKET_OPEN_STATE = 1;
const AVAILABLE_GENERATION_API_TYPES = Object.freeze([
  IMAGE_GENERATION_API_TYPE.OPENAI_RESPONSES,
  IMAGE_GENERATION_API_TYPE.IMAGES_ASYNC,
]);
const GENERATION_API_TYPE_ALIASES = Object.freeze({
  [IMAGE_GENERATION_API_TYPE.OPENAI_RESPONSES]: [
    "responses",
    "responses_api",
    "openai_responses_api",
  ],
  [IMAGE_GENERATION_API_TYPE.IMAGES_ASYNC]: [
    "image_async",
    "images_generations",
    "images",
  ],
});

function tMultimodal(runtime = {}, key = "", params = {}) {
  return tTool(runtime, `tools.multimodal.${String(key || "").trim()}`, params);
}

function resolveModelApiKey(modelSpec = {}) {
  return String(modelSpec?.api_key || "").trim();
}

function resolveModelBaseUrl(modelSpec = {}) {
  return String(modelSpec.base_url || "").trim();
}

function describeBaseUrlForDiagnostics(baseUrl = "") {
  const value = String(baseUrl || "").trim();
  if (!value) return "";
  try {
    const url = new URL(value);
    url.username = "";
    url.password = "";
    url.search = "";
    url.hash = "";
    return url.toString().replace(/\/+$/, "");
  } catch {
    return value.replace(/[?#].*$/, "").replace(/\/+$/, "");
  }
}

function generationApiTypeToCallMode(apiType = "") {
  return apiType === IMAGE_GENERATION_API_TYPE.IMAGES_ASYNC
    ? TOOL_CALL_MODE.IMAGES_ASYNC_API
    : TOOL_CALL_MODE.OPENAI_RESPONSES_API;
}

function resolveGenerateErrorCode(error = {}) {
  const errorCode = String(error?.code || "").trim();
  if (errorCode && errorCode !== "undefined") return errorCode;
  return ERROR_CODE.RECOVERABLE_MULTIMODAL_GENERATE_FAILED;
}

function maskDiagnosticUrl(value = "") {
  const normalized = String(value || "").trim();
  if (!normalized) return "";
  try {
    const url = new URL(normalized);
    if (url.username) url.username = "***";
    if (url.password) url.password = "***";
    url.search = "";
    url.hash = "";
    return url.toString();
  } catch {
    return normalized.replace(/:\/\/([^:@/]+):([^@/]+)@/, "://***:***@").replace(/[?#].*$/, "");
  }
}

function collectProxyEnvDiagnostics(env = process.env) {
  const keys = [
    "HTTP_PROXY",
    "HTTPS_PROXY",
    "ALL_PROXY",
    "NO_PROXY",
    "http_proxy",
    "https_proxy",
    "all_proxy",
    "no_proxy",
  ];
  return Object.fromEntries(
    keys
      .map((key) => [key, maskDiagnosticUrl(env?.[key])])
      .filter(([, value]) => Boolean(value)),
  );
}

function buildFailureDetails({
  message = "",
  modelAlias = "",
  model = "",
  requestedApiType = "",
  generationApiType = "",
  effectiveImageSize = "",
  modelSpec = {},
  requestUrl = "",
  requestMethod = "",
} = {}) {
  const resolvedApiType =
    generationApiType || resolveGenerationApiType(modelSpec || {}, requestedApiType);
  return {
    ...(message ? { message } : {}),
    modelAlias,
    model,
    apiType: resolvedApiType,
    requestedApiType: String(requestedApiType || "").trim(),
    callMode: generationApiTypeToCallMode(resolvedApiType),
    baseUrl: describeBaseUrlForDiagnostics(resolveModelBaseUrl(modelSpec || {})),
    requestUrl: describeBaseUrlForDiagnostics(requestUrl),
    requestMethod: String(requestMethod || "").trim().toUpperCase(),
    imageSize: String(effectiveImageSize || "").trim(),
    availableApiTypes: [...AVAILABLE_GENERATION_API_TYPES],
    apiTypeAliases: GENERATION_API_TYPE_ALIASES,
    platform: process.platform,
    proxyEnv: collectProxyEnvDiagnostics(),
  };
}

function buildMultimodalRequestHeaders(modelName = "", runtime = {}) {
  const sessionId = String(
    runtime?.systemRuntime?.sessionId || runtime?.systemRuntime?.rootSessionId || "",
  ).trim();
  const parentSessionId = resolveParentSessionId({ runtime });
  return {
    [MODEL_NAME_HEADER_KEY]: String(modelName || "").trim() || "unknown_model",
    ...buildPluginModelHeaders({
      flow: MULTIMODAL_FLOW_NAME,
      purpose: MULTIMODAL_PURPOSE_NAME,
      domain: MULTIMODAL_DOMAIN_NAME,
      sessionId,
    }),
    ...(parentSessionId ? { [PARENT_SESSION_HEADER_KEY]: parentSessionId } : {}),
  };
}

async function imageUrlToBase64(url = "", fetchImpl = null, runtime = {}) {
  const normalizedUrl = String(url || "").trim();
  if (!normalizedUrl || typeof fetchImpl !== "function") return "";
  const response = await fetchImpl(normalizedUrl);
  if (!response?.ok) {
    throw recoverableToolError(
      `${tMultimodal(runtime, "fetchGeneratedImageUrlFailed")}: HTTP ${response?.status || 500}`,
      { code: ERROR_CODE.RECOVERABLE_FETCH_GENERATED_IMAGE_URL_FAILED },
    );
  }
  const imageBytes = Buffer.from(await response.arrayBuffer());
  return imageBytes.toString("base64");
}

function checkImageGenerationSupport(modelSpec = {}) {
  const multimodalGeneration = modelSpec?.multimodal_generation || {};
  const supportGeneration = multimodalGeneration?.support_generation || {};
  const generationEnabled = supportGeneration?.enabled === true;
  const supportScope = Array.isArray(supportGeneration?.support_scope)
    ? supportGeneration.support_scope.map((scopeItem) =>
        String(scopeItem || "").trim().toLowerCase(),
      )
    : [];
  const supportImageGeneration = supportScope.includes("image");
  return {
    generationEnabled,
    supportImageGeneration,
  };
}

function parseDataUrlToImageArtifact(dataUrl = "", fileName = "generated_image_1.png") {
  const parsed = parseDataUrl(dataUrl);
  if (!parsed) return null;
  // Use the detected mimeType to generate a proper filename if fileName is default
  const finalFileName = fileName === "generated_image_1.png"
    ? sanitizeGeneratedArtifactName("generated_image_1", parsed.mimeType, 1)
    : fileName;
  return {
    fileName: finalFileName,
    b64Json: parsed.contentBase64,
    url: "",
  };
}

function normalizeImageSize(imageSize = "1024x1024") {
  const normalizedImageSize = String(imageSize || "1024x1024").trim();
  return normalizedImageSize || "1024x1024";
}

function normalizeImageGenerationCount(value = 1) {
  const count = Math.floor(Number(value || 1));
  if (!Number.isFinite(count)) return 1;
  return Math.min(10, Math.max(1, count));
}

function normalizeStringArray(value = []) {
  return (Array.isArray(value) ? value : [])
    .map((item) => String(item || "").trim())
    .filter(Boolean);
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

function buildWebSocketUrl(httpUrl = "") {
  const normalizedUrl = String(httpUrl || "").trim();
  if (!normalizedUrl) return "";
  const parsed = new URL(normalizedUrl);
  if (parsed.protocol === "https:") parsed.protocol = "wss:";
  else if (parsed.protocol === "http:") parsed.protocol = "ws:";
  return parsed.toString();
}

function normalizeGenerationApiType(apiType = "") {
  const normalizedApiType = String(apiType || "").trim().toLowerCase();
  if (["images_async", "image_async", "images_generations", "images"].includes(normalizedApiType)) {
    return IMAGE_GENERATION_API_TYPE.IMAGES_ASYNC;
  }
  if (["openai_responses", "responses", "responses_api", "openai_responses_api"].includes(normalizedApiType)) {
    return IMAGE_GENERATION_API_TYPE.OPENAI_RESPONSES;
  }
  return "";
}

function resolveGenerationApiType(modelSpec = {}, requestedApiType = "") {
  const normalizedRequestedApiType = normalizeGenerationApiType(requestedApiType);
  if (normalizedRequestedApiType) return normalizedRequestedApiType;
  const supportGeneration = modelSpec?.multimodal_generation?.support_generation || {};
  return normalizeGenerationApiType(
    supportGeneration?.api_type ||
      supportGeneration?.apiType ||
      supportGeneration?.endpoint ||
      supportGeneration?.generation_api ||
      "",
  ) || IMAGE_GENERATION_API_TYPE.OPENAI_RESPONSES;
}

function shouldAppendApiTypeHint(error = {}) {
  if (error?.apiTypeSwitchHint === true) return true;
  if (error?.code) {
    return String(error.code || "") === ERROR_CODE.RECOVERABLE_MULTIMODAL_GENERATE_FAILED;
  }
  return Boolean(error?.status || error?.statusCode || error?.payload);
}

function isWebSocketUpgradeError(error = {}) {
  const status = Number(error?.status || error?.statusCode || 0);
  const message = String(
    error?.message || error?.payload?.message || error?.payload?.error || "",
  ).toLowerCase();
  return (
    status === 426 ||
    message.includes("websocket upgrade required") ||
    message.includes("upgrade: websocket")
  );
}

function appendApiTypeHint(message = "", runtime = {}) {
  const baseMessage = String(message || "").trim() || tMultimodal(runtime, "generateFailed");
  const hint = tMultimodal(runtime, "trySwitchApiType");
  return hint ? `${baseMessage}\n${hint}` : baseMessage;
}

function sleep(ms = 0) {
  return new Promise((resolve) => setTimeout(resolve, Math.max(0, Number(ms || 0))));
}

async function loadWebSocketClient() {
  try {
    const websocketLibrary = await import("ws");
    return websocketLibrary.default || websocketLibrary.WebSocket || null;
  } catch {
    return typeof globalThis.WebSocket === "function" ? globalThis.WebSocket : null;
  }
}

function dedupeAttachments(attachments = []) {
  const source = Array.isArray(attachments) ? attachments : [];
  const seen = new Set();
  return source.filter((item = {}) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) return false;
    const key = String(item?.attachmentId || "").trim() ||
      `${String(item?.path || "").trim()}|${String(item?.relativePath || "").trim()}|${String(item?.name || "").trim()}`;
    if (!key) return true;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function resolveGenerationModelSpec({
  modelName = "",
  runtimeModel = "",
  globalConfig = {},
  userConfig = {},
}) {
  const preferredModelName = String(modelName || "").trim();
  const currentRuntimeModel = String(runtimeModel || "").trim();
  const resolvedModelName = preferredModelName || currentRuntimeModel;
  const resolvedModelSpec = resolvedModelName
    ? resolveModelSpecByName({
        modelName: resolvedModelName,
        globalConfig,
        userConfig,
        fallbackToDefault: true,
      })
    : resolveDefaultModelSpec({ globalConfig, userConfig });
  return {
    resolvedModelName,
    resolvedModelSpec,
  };
}

function extractImageArtifactsFromResponsesOutput(responseOutputItems = []) {
  const normalizedOutputItems = Array.isArray(responseOutputItems)
    ? responseOutputItems
    : [];
  const imageArtifacts = [];
  let imageIndex = 0;
  for (const outputItem of normalizedOutputItems) {
    if (!outputItem || typeof outputItem !== "object") continue;
    const outputItemType = String(outputItem?.type || "").trim().toLowerCase();
    const directBase64 = String(
      outputItem?.result || outputItem?.b64_json || outputItem?.image_base64 || "",
    ).trim();
    if (outputItemType.includes("image") && directBase64) {
      imageIndex += 1;
      imageArtifacts.push({
        fileName: `generated_image_${imageIndex}.png`,
        b64Json: directBase64,
        url: "",
      });
      continue;
    }
    const outputContents = Array.isArray(outputItem?.content) ? outputItem.content : [];
    for (const contentItem of outputContents) {
      if (!contentItem || typeof contentItem !== "object") continue;
      const contentItemType = String(contentItem?.type || "").trim().toLowerCase();
      const contentItemBase64 = String(
        contentItem?.result ||
          contentItem?.b64_json ||
          contentItem?.image_base64 ||
          contentItem?.data ||
          "",
      ).trim();
      const imageDataUrl = String(contentItem?.image_url?.url || "").trim();
      if (contentItemType.includes("image") && contentItemBase64) {
        imageIndex += 1;
        imageArtifacts.push({
          fileName: `generated_image_${imageIndex}.png`,
          b64Json: contentItemBase64,
          url: "",
        });
        continue;
      }
      if (contentItemType.includes("image") && imageDataUrl.startsWith("data:image/")) {
        imageIndex += 1;
        const parsedArtifact = parseDataUrlToImageArtifact(
          imageDataUrl,
          `generated_image_${imageIndex}.png`,
        );
        if (parsedArtifact) imageArtifacts.push(parsedArtifact);
      }
    }
  }
  return imageArtifacts;
}

async function generateWithOpenaiResponsesApi({
  openaiClient,
  modelName,
  generationContent,
  imageSize,
}) {
  const generationResult = await openaiClient.responses.create({
    model: String(modelName || "").trim(),
    input: [
      {
        role: "user",
        content: [{ type: "input_text", text: String(generationContent || "").trim() }],
      },
    ],
    tools: [
      {
        type: "image_generation",
        size: normalizeImageSize(imageSize),
      },
    ],
  });
  return {
    imageArtifacts: extractImageArtifactsFromResponsesOutput(generationResult?.output || []),
    rawText: String(generationResult?.output_text || "").trim(),
  };
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
    const error = new Error(message || `HTTP ${response?.status || 500}`);
    error.status = response?.status;
    error.payload = payload;
    error.requestUrl = String(url || "").trim();
    error.requestMethod = String(method || "GET").trim().toUpperCase();
    throw error;
  }
  return payload;
}

async function waitForImagesAsyncTaskViaWebSocket({
  taskUrl = "",
  headers = {},
  taskId = "",
  runtime = {},
} = {}) {
  const WebSocketClient = await loadWebSocketClient();
  if (typeof WebSocketClient !== "function") {
    const error = new Error(tMultimodal(runtime, "fetchUnavailable"));
    error.apiTypeSwitchHint = true;
    throw error;
  }
  const wsUrl = buildWebSocketUrl(taskUrl);
  return new Promise((resolve, reject) => {
    let settled = false;
    let socket = null;
    const finish = (callback, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      try {
        socket?.close?.();
      } catch {
        // ignore close errors
      }
      callback(value);
    };
    const timeout = setTimeout(() => {
      const timeoutError = new Error(tMultimodal(runtime, "taskTimeout", { taskId }));
      timeoutError.apiTypeSwitchHint = true;
      timeoutError.requestUrl = wsUrl;
      timeoutError.requestMethod = "WEBSOCKET";
      finish(reject, timeoutError);
    }, DEFAULT_IMAGE_ASYNC_TIMEOUT_MS);

    try {
      socket = new WebSocketClient(wsUrl, {
        headers,
      });
    } catch (error) {
      error.requestUrl = wsUrl;
      error.requestMethod = "WEBSOCKET";
      finish(reject, error);
      return;
    }

    const handlePayload = (payload = {}) => {
      const normalizedTask = normalizeImagesAsyncTaskPayload(payload || {});
      const status = String(normalizedTask?.status || "").trim().toLowerCase();
      const imageArtifacts = taskPayloadToImageArtifacts(normalizedTask);
      if (status === "failed") {
        const error = new Error(
          String(normalizedTask?.error || normalizedTask?.message || tMultimodal(runtime, "taskFailed")),
        );
        error.apiTypeSwitchHint = true;
        error.requestUrl = wsUrl;
        error.requestMethod = "WEBSOCKET";
        finish(reject, error);
        return;
      }
      if (["completed", "succeeded", "success", "done"].includes(status) || imageArtifacts.length) {
        finish(resolve, {
          taskId,
          imageArtifacts,
          rawText: "",
          rawTask: normalizedTask,
          transport: "websocket",
        });
      }
    };

    const handleOpen = () => {
      if (socket?.readyState === WEBSOCKET_OPEN_STATE) {
        try {
          socket.send(JSON.stringify({ task_id: taskId, taskId, action: "subscribe" }));
        } catch {
          // Some gateways only need the upgraded URL and reject client messages.
        }
      }
    };
    const handleMessage = (eventOrData) => {
      const raw = eventOrData?.data !== undefined ? eventOrData.data : eventOrData;
      let text = "";
      if (typeof raw === "string") text = raw;
      else if (Buffer.isBuffer(raw)) text = raw.toString("utf8");
      else if (raw instanceof ArrayBuffer) text = Buffer.from(raw).toString("utf8");
      else if (Array.isArray(raw)) text = Buffer.concat(raw).toString("utf8");
      if (!text) return;
      try {
        handlePayload(JSON.parse(text));
      } catch {
        handlePayload({ message: text });
      }
    };
    const handleError = (event) => {
      const error = new Error(String(event?.message || "websocket task stream error"));
      error.requestUrl = wsUrl;
      error.requestMethod = "WEBSOCKET";
      finish(reject, error);
    };
    const handleClose = () => {
      if (settled) return;
      const error = new Error(tMultimodal(runtime, "taskFailed"));
      error.requestUrl = wsUrl;
      error.requestMethod = "WEBSOCKET";
      finish(reject, error);
    };
    if (typeof socket.on === "function") {
      socket.on("open", handleOpen);
      socket.on("message", handleMessage);
      socket.on("error", handleError);
      socket.on("close", handleClose);
    }
    socket.onopen = handleOpen;
    socket.onmessage = handleMessage;
    socket.onerror = handleError;
    socket.onclose = handleClose;
  });
}

async function generateWithImagesAsyncApi({
  fetchImpl,
  modelSpec,
  modelName,
  generationContent,
  imageSize,
  resolution = "",
  n = 1,
  quality = "",
  imageUrls = [],
  runtime = {},
}) {
  if (typeof fetchImpl !== "function") {
    throw new Error(tMultimodal(runtime, "fetchUnavailable"));
  }
  const baseUrl = resolveModelBaseUrl(modelSpec || {});
  const apiKey = resolveModelApiKey(modelSpec || {});
  const taskCreateUrl = buildApiUrl(baseUrl, "/v1/images/generations");
  const headers = {
    Authorization: `Bearer ${apiKey}`,
  };
  const requestBody = {
    model: String(modelName || "").trim(),
    prompt: String(generationContent || "").trim(),
    size: normalizeImageSize(imageSize || "1:1"),
    ...(String(resolution || "").trim() ? { resolution: String(resolution || "").trim() } : {}),
    n: normalizeImageGenerationCount(n),
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
    const error = new Error(tMultimodal(runtime, "taskIdMissing"));
    error.apiTypeSwitchHint = true;
    throw error;
  }
  const startedAtMs = Date.now();
  let latestTask = null;
  const taskUrl = buildApiUrl(baseUrl, `/v1/tasks/${encodeURIComponent(taskId)}`);
  while (Date.now() - startedAtMs < DEFAULT_IMAGE_ASYNC_TIMEOUT_MS) {
    try {
      latestTask = await requestJson({
        fetchImpl,
        url: taskUrl,
        method: "GET",
        headers,
      });
    } catch (error) {
      if (isWebSocketUpgradeError(error)) {
        return await waitForImagesAsyncTaskViaWebSocket({
          taskUrl,
          headers,
          taskId,
          runtime,
        });
      }
      throw error;
    }
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
      const error = new Error(String(normalizedTask?.error || normalizedTask?.message || tMultimodal(runtime, "taskFailed")));
      error.apiTypeSwitchHint = true;
      throw error;
    }
    await sleep(DEFAULT_IMAGE_ASYNC_POLL_INTERVAL_MS);
  }
  const timeoutError = new Error(tMultimodal(runtime, "taskTimeout", { taskId }));
  timeoutError.apiTypeSwitchHint = true;
  throw timeoutError;
}


export function createMultimodalGenerateTool({ agentContext }) {
  const runtime = agentContext?.runtime || {};
  const effectiveConfig = mergeConfig(
    runtime?.globalConfig || {},
    runtime?.userConfig || {},
  );
  const toolEnabled =
    effectiveConfig?.tools?.[TOOL_NAME.MULTIMODAL_GENERATE]?.enabled !== false;
  if (!toolEnabled) return [];

  const globalConfig = runtime?.globalConfig || {};
  const userConfig = runtime?.userConfig || {};
  const attachmentService = runtime?.attachmentService || null;
  const userId = String(runtime?.userId || agentContext?.userId || "").trim();
  const sharedFetch =
    typeof runtime?.sharedTools?.fetch === "function"
      ? runtime.sharedTools.fetch
      : typeof globalThis.fetch === "function"
        ? globalThis.fetch.bind(globalThis)
        : null;

  const multimodalGenerateTool = new DynamicStructuredTool({
    name: TOOL_NAME.MULTIMODAL_GENERATE,
    description: tTool(runtime, "tools.multimodal.description"),
    schema: z.object({
      generation_content: z
        .string()
        .describe(tTool(runtime, "tools.multimodal.fieldGenerationContent")),
      model_name: z
        .string()
        .optional()
        .describe(tTool(runtime, "tools.multimodal.fieldModelName")),
      size: z
        .string()
        .optional()
        .describe(tTool(runtime, "tools.multimodal.fieldSize")),
      image_size: z
        .string()
        .optional()
        .describe(tTool(runtime, "tools.multimodal.fieldImageSize")),
      resolution: z
        .string()
        .optional()
        .describe(tTool(runtime, "tools.multimodal.fieldResolution")),
      n: z
        .number()
        .optional()
        .describe(tTool(runtime, "tools.multimodal.fieldN")),
      quality: z
        .string()
        .optional()
        .describe(tTool(runtime, "tools.multimodal.fieldQuality")),
      image_urls: z
        .array(z.string())
        .optional()
        .describe(tTool(runtime, "tools.multimodal.fieldImageUrls")),
      api_type: z
        .string()
        .optional()
        .describe(tTool(runtime, "tools.multimodal.fieldApiType")),
    }),
    func: async ({
      generation_content,
      model_name = "",
      image_size = "",
      size = "",
      resolution = "",
      n = 1,
      quality = "",
      image_urls = [],
      api_type = "",
    }) => {
      const generationContent = String(generation_content || "").trim();
      let resolvedModelSpec = null;
      let generationApiType = "";
      let effectiveImageSize = "";
      const requestedApiType = String(api_type || "").trim();
      if (!generationContent) {
        throw recoverableToolError(tMultimodal(runtime, "generationContentRequired"), {
          code: ERROR_CODE.RECOVERABLE_INPUT_MISSING,
        });
      }
      try {
        const {
          resolvedModelName,
          resolvedModelSpec: selectedModelSpec,
        } = resolveGenerationModelSpec({
          modelName: model_name,
          runtimeModel: runtime?.runtimeModel,
          globalConfig,
          userConfig,
        });
        resolvedModelSpec = selectedModelSpec;
        const generationSupport = checkImageGenerationSupport(
          resolvedModelSpec || {},
        );
        if (
          !generationSupport.generationEnabled ||
          !generationSupport.supportImageGeneration
        ) {
          const currentModelAlias = String(
            resolvedModelSpec?.alias || resolvedModelName || "",
          ).trim();
          const currentModelName = String(resolvedModelSpec?.model || "").trim();
          throw recoverableToolError(
            tMultimodal(runtime, "multimodalUnsupportedError", {
              model: currentModelAlias || currentModelName || "unknown_model",
            }),
            {
              code: ERROR_CODE.RECOVERABLE_MODEL_MULTIMODAL_GENERATION_UNSUPPORTED,
              details: {
                message: tMultimodal(runtime, "multimodalUnsupportedMessage"),
                modelAlias: currentModelAlias,
                model: currentModelName,
              },
            },
          );
        }
        const modelNameForGeneration = String(
          resolvedModelSpec?.model || resolvedModelName || "",
        ).trim();
        generationApiType = resolveGenerationApiType(resolvedModelSpec || {}, requestedApiType);
        effectiveImageSize = String(size || image_size || "").trim() ||
          (generationApiType === IMAGE_GENERATION_API_TYPE.IMAGES_ASYNC ? "1:1" : "1024x1024");
        const modelApiKey = resolveModelApiKey(resolvedModelSpec || {});
        if (!modelApiKey) {
          throw recoverableToolError(tMultimodal(runtime, "modelApiKeyMissing"), {
            code: ERROR_CODE.RECOVERABLE_MODEL_API_KEY_MISSING,
            details: {
              modelAlias: String(resolvedModelSpec?.alias || "").trim(),
              model: String(resolvedModelSpec?.model || "").trim(),
            },
          });
        }
        const generationResult =
          generationApiType === IMAGE_GENERATION_API_TYPE.IMAGES_ASYNC
            ? await generateWithImagesAsyncApi({
                fetchImpl: sharedFetch,
                modelSpec: resolvedModelSpec,
                modelName: modelNameForGeneration,
                generationContent,
                imageSize: effectiveImageSize,
                resolution,
                n,
                quality,
                imageUrls: normalizeStringArray(image_urls),
                runtime,
              })
            : await generateWithOpenaiResponsesApi({
                openaiClient: new OpenAI({
                  apiKey: modelApiKey,
                  ...(resolveModelBaseUrl(resolvedModelSpec || {})
                    ? { baseURL: resolveModelBaseUrl(resolvedModelSpec || {}) }
                    : {}),
                  defaultHeaders: buildMultimodalRequestHeaders(modelNameForGeneration, runtime),
                }),
                modelName: modelNameForGeneration,
                generationContent,
                imageSize: effectiveImageSize,
              });
        const imageArtifacts = Array.isArray(generationResult?.imageArtifacts)
          ? generationResult.imageArtifacts
          : [];
        const generatedAttachments = [];
        for (const imageArtifact of imageArtifacts) {
          const resolvedBase64 =
            imageArtifact.b64Json ||
            (await imageUrlToBase64(imageArtifact.url, sharedFetch, runtime));
          if (!resolvedBase64) continue;
          generatedAttachments.push({
            name: imageArtifact.fileName,
            mimeType: MIME_TYPE.IMAGE_PNG,
            contentBase64: resolvedBase64,
          });
        }
        const attachmentRecords =
          attachmentService && userId && generatedAttachments.length
            ? await attachmentService.ingestGeneratedArtifacts({
                userId,
                sessionId: String(
                  runtime?.systemRuntime?.sessionId ||
                    runtime?.systemRuntime?.rootSessionId ||
                    "",
                ).trim(),
                attachmentSource: TOOL_ATTACHMENT_SOURCE.MODEL,
                artifacts: generatedAttachments,
                generationSource: ARTIFACT_GENERATION_SOURCE.MULTIMODAL_GENERATE_TOOL,
              })
            : [];
        const mergedAttachments = dedupeAttachments(
          mapAttachmentRecordsToMetas(attachmentRecords, {
            fallbackMimeType: MIME_TYPE.IMAGE_PNG,
            fallbackGenerationSource: ARTIFACT_GENERATION_SOURCE.MULTIMODAL_GENERATE_TOOL,
          }),
        );
        return toToolJsonResult(
          TOOL_NAME.MULTIMODAL_GENERATE,
          {
            ok: true,
            status: TOOL_RESULT_STATUS.COMPLETED,
            callMode: generationApiTypeToCallMode(generationApiType),
            modelAlias: String(resolvedModelSpec?.alias || "").trim(),
            model: String(resolvedModelSpec?.model || "").trim(),
            text: String(generationResult?.rawText || "").trim(),
            generationContentSource: "tool_input_generation_content",
            attachments: mergedAttachments,
            summary: {
              task_id: String(generationResult?.taskId || "").trim(),
              generated_image_count: imageArtifacts.length,
              saved_attachment_count: mergedAttachments.length,
            },
          },
          true,
        );
      } catch (error) {
        const errorStatusCode = Number(error?.status || error?.statusCode || 0);
        const errorMessage = String(error?.message || String(error || "")).trim();
        const normalizedMessage = errorMessage.toLowerCase();
        const modelAlias = String(resolvedModelSpec?.alias || "").trim();
        const modelName = String(resolvedModelSpec?.model || "").trim();

        if (
          errorStatusCode === 403 &&
          normalizedMessage.includes("images api is not enabled")
        ) {
          const hintMessage = appendApiTypeHint(
            tMultimodal(runtime, "imagesApiNotEnabledError"),
            runtime,
          );
          throw recoverableToolError(hintMessage, {
            code: ERROR_CODE.RECOVERABLE_IMAGES_API_NOT_ENABLED,
            details: buildFailureDetails({
              message: hintMessage,
              modelAlias,
              model: modelName,
              requestedApiType,
              generationApiType,
              effectiveImageSize,
              modelSpec: resolvedModelSpec || {},
              requestUrl: error?.requestUrl,
              requestMethod: error?.requestMethod,
            }),
          });
        }
        if (!shouldAppendApiTypeHint(error)) {
          throw recoverableToolError(
            errorMessage || tMultimodal(runtime, "generateFailed"),
            {
              code: resolveGenerateErrorCode(error),
              details: buildFailureDetails({
                modelAlias,
                model: modelName,
                requestedApiType,
                generationApiType,
                effectiveImageSize,
                modelSpec: resolvedModelSpec || {},
                requestUrl: error?.requestUrl,
                requestMethod: error?.requestMethod,
              }),
            },
          );
        }
        const hintMessage = appendApiTypeHint(
          errorMessage || tMultimodal(runtime, "generateFailed"),
          runtime,
        );
        throw recoverableToolError(
          hintMessage,
          {
            code: resolveGenerateErrorCode(error),
            details: buildFailureDetails({
              message: hintMessage,
              modelAlias,
              model: modelName,
              requestedApiType,
              generationApiType,
              effectiveImageSize,
              modelSpec: resolvedModelSpec || {},
              requestUrl: error?.requestUrl,
              requestMethod: error?.requestMethod,
            }),
          },
        );
      }
    },
  });

  return [multimodalGenerateTool];
}
