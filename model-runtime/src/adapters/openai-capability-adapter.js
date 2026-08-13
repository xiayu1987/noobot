/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import OpenAI from "openai";
import { TIME_THRESHOLDS } from "@noobot/shared/time-thresholds";
import { IMAGE_GENERATION_API_TYPE, MODEL_OPERATION_KIND } from "@noobot/model-protocol";

const POLL_INTERVAL_MS = TIME_THRESHOLDS.tools.imagesAsyncPollIntervalMs;
const TIMEOUT_MS = TIME_THRESHOLDS.tools.imagesAsyncTimeoutMs;
const RATIO_SIZE = /^(auto|\d+(?:\.\d+)?:\d+(?:\.\d+)?)$/i;
// OpenAI's documented status-level meanings are only used when the provider
// does not return a usable error message. A compatible provider's own message
// is more specific and must remain visible to the caller.
const HTTP_STATUS_FALLBACKS = Object.freeze({
  "zh-CN": Object.freeze({
    400: "请求参数或格式无效",
    401: "认证失败，请检查 API Key",
    403: "没有访问该资源的权限",
    404: "请求的资源不存在",
    429: "请求过于频繁或账户额度已用尽",
    500: "服务端处理错误，请稍后重试",
    503: "服务当前过载，请稍后重试",
  }),
  "en-US": Object.freeze({
    400: "Invalid request parameters or format",
    401: "Authentication failed; check your API key",
    403: "You do not have permission to access this resource",
    404: "The requested resource was not found",
    429: "Too many requests or account quota exhausted",
    500: "Server error while processing the request; try again later",
    503: "The service is currently overloaded; try again later",
  }),
});

function normalizeLocale(locale = "") {
  return String(locale || "")
    .trim()
    .toLowerCase()
    .startsWith("en")
    ? "en-US"
    : "zh-CN";
}

const IMAGES_ASYNC_FALLBACKS = Object.freeze({
  "zh-CN": Object.freeze({
    taskIdMissing: "缺少任务 ID",
    taskFailed: "任务执行失败",
    taskTimeout: (id) => `任务超时：${id}`,
  }),
  "en-US": Object.freeze({
    taskIdMissing: "Task ID is missing",
    taskFailed: "Task failed",
    taskTimeout: (id) => `Task timed out: ${id}`,
  }),
});

function normalizeBaseUrl(baseUrl = "") {
  const normalized = String(baseUrl || "")
    .trim()
    .replace(/\/+$/, "");
  if (!normalized) return "";
  try {
    const url = new URL(normalized);
    const pathname = url.pathname.replace(/\/+$/, "");
    if (/\/chatgpt\/v1$/i.test(pathname)) url.pathname = pathname.replace(/\/chatgpt\/v1$/i, "/v1");
    url.search = "";
    url.hash = "";
    return url.toString().replace(/\/+$/, "");
  } catch {
    return normalized.replace(/\/chatgpt\/v1$/i, "/v1");
  }
}

function buildApiUrl(baseUrl = "", path = "") {
  const base = normalizeBaseUrl(baseUrl);
  if (base.endsWith("/v1") && path.startsWith("/v1/")) return `${base}${path.slice(3)}`;
  return `${base}${path}`;
}

function normalizeCount(value = 1, modelName = "") {
  const count = Math.min(10, Math.max(1, Math.floor(Number(value || 1)) || 1));
  return String(modelName || "")
    .trim()
    .toLowerCase() === "gpt-image-2-beta"
    ? 1
    : count;
}

function unwrapPayload(payload = {}) {
  const source = payload && typeof payload === "object" ? payload : {};
  for (const key of ["data", "payload", "result"]) {
    const nested = source[key];
    if (nested && typeof nested === "object" && !Array.isArray(nested))
      Object.assign(source, nested);
  }
  return source;
}

function normalizeTask(payload = {}) {
  const source = unwrapPayload({ ...payload });
  const data = Array.isArray(source.data) ? source.data : source.data ? [source.data] : [];
  const first = data.find((item) => item && typeof item === "object") || {};
  return {
    ...source,
    ...first,
    result_data:
      source.result_data ||
      source.resultData ||
      source.images ||
      source.output ||
      first.result_data ||
      first.resultData ||
      first.images ||
      first.output ||
      [],
  };
}

function taskId(payload = {}) {
  const task = normalizeTask(payload);
  return String(task.id || task.task_id || task.taskId || "").trim();
}

function imageArtifacts(items = []) {
  return (Array.isArray(items) ? items : [])
    .map((item = {}, index) => {
      const value = String(
        item.b64_json || item.image_base64 || item.base64 || item.data || "",
      ).trim();
      const dataUrlMatch = /^data:[^;]+;base64,(.+)$/i.exec(value);
      return {
        fileName: `generated_image_${index + 1}.png`,
        b64Json: dataUrlMatch ? dataUrlMatch[1] : value,
        url: String(item.url || item.image_url || "").trim(),
      };
    })
    .filter((item) => item.b64Json || item.url);
}

async function requestJson({
  fetchImpl,
  url,
  method = "GET",
  headers = {},
  body,
  signal,
  locale = "zh-CN",
}) {
  let response;
  try {
    response = await fetchImpl(url, {
      method,
      headers: { ...headers, ...(body ? { "Content-Type": "application/json" } : {}) },
      ...(body ? { body: JSON.stringify(body) } : {}),
      ...(signal ? { signal } : {}),
    });
  } catch (error) {
    error.requestUrl = url;
    error.requestMethod = method;
    throw error;
  }
  const responseText = await response.text();
  let payload;
  let parsedJson = false;
  try {
    payload = responseText ? JSON.parse(responseText) : {};
    parsedJson = true;
  } catch {
    payload = { message: responseText };
  }
  if (!response.ok) {
    const returnedMessage = String(
      (typeof payload?.error?.message === "string" ? payload.error.message : "") ||
        (typeof payload?.message === "string" ? payload.message : "") ||
        (typeof payload?.error === "string" ? payload.error : "") ||
        (!parsedJson ? responseText : "") ||
        "",
    ).trim();
    const message =
      returnedMessage ||
      HTTP_STATUS_FALLBACKS[normalizeLocale(locale)]?.[response.status] ||
      `HTTP ${response.status}`;
    const error = new Error(message);
    error.status = response.status;
    error.payload = payload;
    error.requestUrl = url;
    error.requestMethod = method;
    throw error;
  }
  return payload;
}

async function executeImagesAsync({
  modelSpec,
  credential,
  input,
  options,
  signal,
  fetchImpl,
  clock,
  locale,
}) {
  const localized = IMAGES_ASYNC_FALLBACKS[normalizeLocale(locale)];
  const baseUrl = normalizeBaseUrl(modelSpec.base_url);
  const createUrl = buildApiUrl(baseUrl, "/v1/images/generations");
  const headers = { Authorization: `Bearer ${credential}`, ...(options.headers || {}) };
  const size = String(options.size || "1:1").trim() || "1:1";
  const resolution = String(options.resolution || "").trim() || (RATIO_SIZE.test(size) ? "1K" : "");
  const created = await requestJson({
    fetchImpl,
    url: createUrl,
    method: "POST",
    headers,
    signal,
    locale,
    body: {
      model: modelSpec.model,
      prompt: String(input.prompt || "").trim(),
      size,
      ...(resolution ? { resolution } : {}),
      n: normalizeCount(options.n, modelSpec.model),
      ...(String(options.quality || "").trim() ? { quality: String(options.quality).trim() } : {}),
      ...(Array.isArray(options.imageUrls) && options.imageUrls.length
        ? { image_urls: options.imageUrls }
        : {}),
    },
  });
  const id = taskId(created);
  if (!id) {
    const error = new Error(String(options.taskIdMissingMessage || localized.taskIdMissing));
    error.apiTypeSwitchHint = true;
    throw error;
  }
  const taskUrl = buildApiUrl(baseUrl, `/v1/tasks/${encodeURIComponent(id)}`);
  const startedAt = Date.now();
  while (Date.now() - startedAt < Number(options.timeoutMs || TIMEOUT_MS)) {
    const task = normalizeTask(
      await requestJson({ fetchImpl, url: taskUrl, headers, signal, locale }),
    );
    const status = String(task.status || "")
      .trim()
      .toLowerCase();
    if (status === "completed") {
      return {
        taskId: id,
        imageArtifacts: imageArtifacts(task.result_data),
        rawText: "",
        rawTask: task,
      };
    }
    if (status === "failed") {
      const error = new Error(
        String(task.error || task.message || options.taskFailedMessage || localized.taskFailed),
      );
      error.apiTypeSwitchHint = true;
      throw error;
    }
    await clock.sleep(Number(options.pollIntervalMs || POLL_INTERVAL_MS));
  }
  const error = new Error(String(options.taskTimeoutMessage || localized.taskTimeout(id)));
  error.apiTypeSwitchHint = true;
  throw error;
}

function extractResponsesImages(output = []) {
  const artifacts = [];
  for (const item of Array.isArray(output) ? output : []) {
    const values = [item, ...(Array.isArray(item?.content) ? item.content : [])];
    for (const value of values) {
      const type = String(value?.type || "").toLowerCase();
      if (!type.includes("image")) continue;
      const b64Json = String(
        value?.result || value?.b64_json || value?.image_base64 || value?.data || "",
      ).trim();
      const url = String(value?.image_url?.url || value?.url || "").trim();
      if (b64Json || url)
        artifacts.push({ fileName: `generated_image_${artifacts.length + 1}.png`, b64Json, url });
    }
  }
  return artifacts;
}

export async function executeOpenAiOperation({
  modelSpec,
  credential,
  operation,
  headers = {},
  signal,
  fetchImpl = globalThis.fetch,
  clock = { sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)) },
  locale = "zh-CN",
  mapMultimodalAttachment = mapOpenAiMultimodalAttachment,
  multimodalParseTransport = "responses",
  openAiClientFactory = (config) => new OpenAI(config),
}) {
  if (
    operation.kind === MODEL_OPERATION_KIND.IMAGE_GENERATION &&
    operation.options.apiType === IMAGE_GENERATION_API_TYPE.IMAGES_ASYNC
  ) {
    return executeImagesAsync({
      modelSpec,
      credential,
      input: operation.input,
      options: operation.options,
      signal,
      fetchImpl,
      clock,
      locale,
    });
  }
  const client = openAiClientFactory({
    apiKey: credential,
    ...(modelSpec.base_url ? { baseURL: modelSpec.base_url } : {}),
    defaultHeaders: headers,
  });
  if (operation.kind === MODEL_OPERATION_KIND.WEB_SEARCH) {
    const result = await client.responses.create(
      {
        model: modelSpec.model,
        input: [
          {
            role: "user",
            content: [{ type: "input_text", text: String(operation.input.query || "").trim() }],
          },
        ],
        tools: [{ type: "web_search" }],
      },
      { signal: signal || undefined },
    );
    return {
      rawText: String(result?.output_text || "").trim(),
      output: Array.isArray(result?.output) ? result.output : [],
    };
  }
  if (operation.kind === MODEL_OPERATION_KIND.MULTIMODAL_PARSE) {
    const attachmentContent = operation.input.attachments.map(mapMultimodalAttachment);
    if (multimodalParseTransport === "chat_completions") {
      const completion = await client.chat.completions.create(
        {
          model: modelSpec.model,
          messages: [
            {
              role: "user",
              content: [
                { type: "text", text: String(operation.input.prompt || "").trim() },
                ...attachmentContent,
              ],
            },
          ],
        },
        { signal: signal || undefined },
      );
      const content = completion?.choices?.[0]?.message?.content;
      const rawText =
        typeof content === "string"
          ? content.trim()
          : (Array.isArray(content) ? content : [])
              .filter((item) => String(item?.type || "").trim() === "text")
              .map((item) => String(item?.text || ""))
              .join("")
              .trim();
      return { rawText, output: [] };
    }
    const result = await client.responses.create(
      {
        model: modelSpec.model,
        input: [
          {
            role: "user",
            content: [
              { type: "input_text", text: String(operation.input.prompt || "").trim() },
              ...attachmentContent,
            ],
          },
        ],
      },
      { signal: signal || undefined },
    );
    return {
      rawText: String(result?.output_text || "").trim(),
      output: Array.isArray(result?.output) ? result.output : [],
    };
  }
  if (operation.kind === MODEL_OPERATION_KIND.IMAGE_GENERATION) {
    const result = await client.responses.create(
      {
        model: modelSpec.model,
        input: [
          {
            role: "user",
            content: [{ type: "input_text", text: String(operation.input.prompt || "").trim() }],
          },
        ],
        tools: [
          { type: "image_generation", size: String(operation.options.size || "1024x1024").trim() },
        ],
      },
      { signal: signal || undefined },
    );
    return {
      rawText: String(result?.output_text || "").trim(),
      imageArtifacts: extractResponsesImages(result?.output),
      output: Array.isArray(result?.output) ? result.output : [],
    };
  }
  throw new TypeError(`unsupported OpenAI model operation: ${operation.kind}`);
}

export function mapOpenAiMultimodalAttachment(attachment = {}) {
  const mimeType = String(attachment.mimeType || "application/octet-stream").trim();
  const data = String(attachment.data || "").trim();
  const normalizedMimeType = mimeType.toLowerCase();
  if (normalizedMimeType.startsWith("image/")) return { type: "input_image", image_url: data };
  if (normalizedMimeType.startsWith("audio/")) {
    const format = ["audio/wav", "audio/x-wav"].includes(normalizedMimeType) ? "wav" : "mp3";
    const base64 = data.startsWith("data:") ? data.slice(data.indexOf(",") + 1) : data;
    return { type: "input_audio", input_audio: { data: base64, format } };
  }
  return {
    type: "input_file",
    file_data: data,
    filename: String(attachment.fileName || "").trim() || undefined,
  };
}
