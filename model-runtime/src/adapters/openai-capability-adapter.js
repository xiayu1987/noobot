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
const HTTP_STATUS_HINTS = Object.freeze({
  400: "参数错误，如不支持的 size 格式",
  401: "API Key 无效",
  402: "余额不足",
  404: "任务不存在或无权访问；任务查询只能查询自己创建的任务",
  503: "无可用渠道",
});

function normalizeBaseUrl(baseUrl = "") {
  const normalized = String(baseUrl || "").trim().replace(/\/+$/, "");
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
  return String(modelName || "").trim().toLowerCase() === "gpt-image-2-beta" ? 1 : count;
}

function unwrapPayload(payload = {}) {
  const source = payload && typeof payload === "object" ? payload : {};
  for (const key of ["data", "payload", "result"]) {
    const nested = source[key];
    if (nested && typeof nested === "object" && !Array.isArray(nested)) Object.assign(source, nested);
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
    result_data: source.result_data || source.resultData || source.images || source.output || first.result_data || first.resultData || first.images || first.output || [],
  };
}

function taskId(payload = {}) {
  const task = normalizeTask(payload);
  return String(task.id || task.task_id || task.taskId || "").trim();
}

function imageArtifacts(items = []) {
  return (Array.isArray(items) ? items : [])
    .map((item = {}, index) => {
      const value = String(item.b64_json || item.image_base64 || item.base64 || item.data || "").trim();
      const dataUrlMatch = /^data:[^;]+;base64,(.+)$/i.exec(value);
      return {
        fileName: `generated_image_${index + 1}.png`,
        b64Json: dataUrlMatch ? dataUrlMatch[1] : value,
        url: String(item.url || item.image_url || "").trim(),
      };
    })
    .filter((item) => item.b64Json || item.url);
}

async function requestJson({ fetchImpl, url, method = "GET", headers = {}, body, signal }) {
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
  try { payload = responseText ? JSON.parse(responseText) : {}; } catch { payload = { message: responseText }; }
  if (!response.ok) {
    const hint = HTTP_STATUS_HINTS[response.status] || "";
    const message = String(payload?.error?.message || payload?.message || payload?.error || responseText || `HTTP ${response.status}`).trim();
    const error = new Error([message, hint].filter(Boolean).join("；"));
    error.status = response.status;
    error.payload = payload;
    error.requestUrl = url;
    error.requestMethod = method;
    throw error;
  }
  return payload;
}

async function executeImagesAsync({ modelSpec, credential, input, options, signal, fetchImpl, clock }) {
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
    body: {
      model: modelSpec.model,
      prompt: String(input.prompt || "").trim(),
      size,
      ...(resolution ? { resolution } : {}),
      n: normalizeCount(options.n, modelSpec.model),
      ...(String(options.quality || "").trim() ? { quality: String(options.quality).trim() } : {}),
      ...(Array.isArray(options.imageUrls) && options.imageUrls.length ? { image_urls: options.imageUrls } : {}),
    },
  });
  const id = taskId(created);
  if (!id) {
    const error = new Error(String(options.taskIdMissingMessage || "Task id missing"));
    error.apiTypeSwitchHint = true;
    throw error;
  }
  const taskUrl = buildApiUrl(baseUrl, `/v1/tasks/${encodeURIComponent(id)}`);
  const startedAt = Date.now();
  while (Date.now() - startedAt < Number(options.timeoutMs || TIMEOUT_MS)) {
    const task = normalizeTask(await requestJson({ fetchImpl, url: taskUrl, headers, signal }));
    const status = String(task.status || "").trim().toLowerCase();
    if (status === "completed") {
      return { taskId: id, imageArtifacts: imageArtifacts(task.result_data), rawText: "", rawTask: task };
    }
    if (status === "failed") {
      const error = new Error(String(task.error || task.message || options.taskFailedMessage || "Task failed"));
      error.apiTypeSwitchHint = true;
      throw error;
    }
    await clock.sleep(Number(options.pollIntervalMs || POLL_INTERVAL_MS));
  }
  const error = new Error(String(options.taskTimeoutMessage || `Task timed out: ${id}`));
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
      const b64Json = String(value?.result || value?.b64_json || value?.image_base64 || value?.data || "").trim();
      const url = String(value?.image_url?.url || value?.url || "").trim();
      if (b64Json || url) artifacts.push({ fileName: `generated_image_${artifacts.length + 1}.png`, b64Json, url });
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
  openAiClientFactory = (config) => new OpenAI(config),
}) {
  if (
    operation.kind === MODEL_OPERATION_KIND.IMAGE_GENERATION &&
    operation.options.apiType === IMAGE_GENERATION_API_TYPE.IMAGES_ASYNC
  ) {
    return executeImagesAsync({ modelSpec, credential, input: operation.input, options: operation.options, signal, fetchImpl, clock });
  }
  const client = openAiClientFactory({
    apiKey: credential,
    ...(modelSpec.base_url ? { baseURL: modelSpec.base_url } : {}),
    defaultHeaders: headers,
  });
  if (operation.kind === MODEL_OPERATION_KIND.WEB_SEARCH) {
    const result = await client.responses.create({
      model: modelSpec.model,
      input: [{ role: "user", content: [{ type: "input_text", text: String(operation.input.query || "").trim() }] }],
      tools: [{ type: "web_search" }],
    }, { signal: signal || undefined });
    return { rawText: String(result?.output_text || "").trim(), output: Array.isArray(result?.output) ? result.output : [] };
  }
  if (operation.kind === MODEL_OPERATION_KIND.IMAGE_GENERATION) {
    const result = await client.responses.create({
      model: modelSpec.model,
      input: [{ role: "user", content: [{ type: "input_text", text: String(operation.input.prompt || "").trim() }] }],
      tools: [{ type: "image_generation", size: String(operation.options.size || "1024x1024").trim() }],
    }, { signal: signal || undefined });
    return {
      rawText: String(result?.output_text || "").trim(),
      imageArtifacts: extractResponsesImages(result?.output),
      output: Array.isArray(result?.output) ? result.output : [],
    };
  }
  throw new TypeError(`unsupported OpenAI model operation: ${operation.kind}`);
}
