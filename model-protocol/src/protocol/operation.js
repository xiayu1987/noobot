/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
export const MODEL_OPERATION_KIND = Object.freeze({
  CHAT: "chat",
  WEB_SEARCH: "web_search",
  IMAGE_GENERATION: "image_generation",
});

const OPERATION_KINDS = new Set(Object.values(MODEL_OPERATION_KIND));

export const IMAGE_GENERATION_API_TYPE = Object.freeze({
  OPENAI_RESPONSES: "openai_responses",
  IMAGES_ASYNC: "images_async",
});

const IMAGE_API_TYPES = new Set(Object.values(IMAGE_GENERATION_API_TYPE));

function requirePlainObject(value, path) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError(`${path} must be an object`);
  }
  return value;
}

function rejectUnknownKeys(value, allowedKeys, path) {
  const allowed = new Set(allowedKeys);
  const unknown = Object.keys(value).filter((key) => !allowed.has(key));
  if (unknown.length) throw new TypeError(`${path} contains unsupported fields: ${unknown.join(", ")}`);
}

function requireText(value, path) {
  const text = String(value || "").trim();
  if (!text) throw new TypeError(`${path} is required`);
  return text;
}

function normalizeImageOptions(input = {}) {
  const source = requirePlainObject(input, "model operation.options");
  rejectUnknownKeys(source, ["apiType", "size", "resolution", "n", "quality", "imageUrls"], "model operation.options");
  const apiType = String(source.apiType || IMAGE_GENERATION_API_TYPE.OPENAI_RESPONSES).trim().toLowerCase();
  if (!IMAGE_API_TYPES.has(apiType)) throw new TypeError(`unsupported image generation api type: ${apiType}`);
  const count = source.n === undefined ? 1 : Number(source.n);
  if (!Number.isInteger(count) || count < 1 || count > 10) {
    throw new TypeError("model operation.options.n must be an integer between 1 and 10");
  }
  const imageUrls = source.imageUrls === undefined ? [] : source.imageUrls;
  if (!Array.isArray(imageUrls) || imageUrls.some((value) => !String(value || "").trim())) {
    throw new TypeError("model operation.options.imageUrls must be an array of non-empty strings");
  }
  return Object.freeze({
    apiType,
    size: String(source.size || (apiType === IMAGE_GENERATION_API_TYPE.IMAGES_ASYNC ? "1:1" : "1024x1024")).trim(),
    resolution: String(source.resolution || "").trim(),
    n: count,
    quality: String(source.quality || "").trim(),
    imageUrls: Object.freeze(imageUrls.map((value) => String(value).trim())),
  });
}

export function normalizeModelOperation(input = {}) {
  const source = requirePlainObject(input && typeof input === "object" ? input : {}, "model operation");
  rejectUnknownKeys(source, ["kind", "input", "options"], "model operation");
  const kind = String(source.kind || MODEL_OPERATION_KIND.CHAT).trim().toLowerCase();
  if (!OPERATION_KINDS.has(kind)) {
    throw new TypeError(`unsupported model operation: ${kind || "missing"}`);
  }
  const operationInput = requirePlainObject(source.input || {}, "model operation.input");
  const operationOptions = requirePlainObject(source.options || {}, "model operation.options");
  if (kind === MODEL_OPERATION_KIND.CHAT) {
    rejectUnknownKeys(operationInput, [], "model operation.input");
    rejectUnknownKeys(operationOptions, [], "model operation.options");
    return Object.freeze({ kind, input: Object.freeze({}), options: Object.freeze({}) });
  }
  if (kind === MODEL_OPERATION_KIND.WEB_SEARCH) {
    rejectUnknownKeys(operationInput, ["query"], "model operation.input");
    rejectUnknownKeys(operationOptions, [], "model operation.options");
    return Object.freeze({
      kind,
      input: Object.freeze({ query: requireText(operationInput.query, "model operation.input.query") }),
      options: Object.freeze({}),
    });
  }
  rejectUnknownKeys(operationInput, ["prompt"], "model operation.input");
  return Object.freeze({
    kind,
    input: Object.freeze({ prompt: requireText(operationInput.prompt, "model operation.input.prompt") }),
    options: normalizeImageOptions(operationOptions),
  });
}

function normalizeImageArtifact(value, index) {
  const path = `model response.result.imageArtifacts[${index}]`;
  const artifact = requirePlainObject(value, path);
  rejectUnknownKeys(artifact, ["fileName", "b64Json", "url"], path);
  const b64Json = String(artifact.b64Json || "").trim();
  const url = String(artifact.url || "").trim();
  if (!b64Json && !url) throw new TypeError(`${path} requires b64Json or url`);
  return Object.freeze({
    fileName: requireText(artifact.fileName, `${path}.fileName`),
    b64Json,
    url,
  });
}

export function normalizeModelOperationResult(kind, input = {}) {
  const operationKind = String(kind || "").trim().toLowerCase();
  if (!OPERATION_KINDS.has(operationKind)) {
    throw new TypeError(`unsupported model operation result: ${operationKind || "missing"}`);
  }
  const source = requirePlainObject(input, "model response.result");
  if (operationKind === MODEL_OPERATION_KIND.CHAT) {
    rejectUnknownKeys(source, [], "model response.result");
    return Object.freeze({});
  }
  if (operationKind === MODEL_OPERATION_KIND.WEB_SEARCH) {
    rejectUnknownKeys(source, ["rawText", "output"], "model response.result");
    if (!Array.isArray(source.output)) throw new TypeError("model response.result.output must be an array");
    return Object.freeze({
      rawText: String(source.rawText || "").trim(),
      output: Object.freeze([...source.output]),
    });
  }
  rejectUnknownKeys(source, ["rawText", "imageArtifacts", "output", "taskId", "rawTask"], "model response.result");
  if (!Array.isArray(source.imageArtifacts)) {
    throw new TypeError("model response.result.imageArtifacts must be an array");
  }
  if (source.output !== undefined && !Array.isArray(source.output)) {
    throw new TypeError("model response.result.output must be an array");
  }
  if (source.rawTask !== undefined) requirePlainObject(source.rawTask, "model response.result.rawTask");
  return Object.freeze({
    rawText: String(source.rawText || "").trim(),
    imageArtifacts: Object.freeze(source.imageArtifacts.map(normalizeImageArtifact)),
    output: Object.freeze([...(source.output || [])]),
    taskId: String(source.taskId || "").trim(),
    ...(source.rawTask === undefined ? {} : { rawTask: Object.freeze({ ...source.rawTask }) }),
  });
}
