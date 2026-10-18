/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import {
  MODEL_INPUT_PROCESSING_KIND,
  classifyModelInputProcessing,
} from "../model/model-input-processing.js";
import { text, isPlainObject } from "@noobot/shared/value";

export const MODEL_OPERATION_KIND = Object.freeze({
  CHAT: "chat",
  WEB_SEARCH: "web_search",
  IMAGE_GENERATION: "image_generation",
  MULTIMODAL_PARSE: "multimodal_parse",
});

export const MODEL_WEB_SEARCH_INSTRUCTION =
  "Search the web before answering. Answer only from the search results.";

const OPERATION_KINDS = new Set(Object.values(MODEL_OPERATION_KIND));

function requirePlainObject(value, path) {
  if (!isPlainObject(value)) {
    throw new TypeError(`${path} must be an object`);
  }
  return value;
}

function rejectUnknownKeys(value, allowedKeys, path) {
  const allowed = new Set(allowedKeys);
  const unknown = Object.keys(value).filter((key) => !allowed.has(key));
  if (unknown.length)
    throw new TypeError(`${path} contains unsupported fields: ${unknown.join(", ")}`);
}

function requireText(value, path) {
  const normalizedText = text(value);
  if (!normalizedText) throw new TypeError(`${path} is required`);
  return normalizedText;
}

function normalizeImageOptions(input = {}) {
  const source = requirePlainObject(input, "model operation.options");
  rejectUnknownKeys(
    source,
    ["size", "resolution", "n", "quality", "imageUrls"],
    "model operation.options",
  );
  const count = source.n === undefined ? 1 : Number(source.n);
  if (!Number.isInteger(count) || count < 1 || count > 10) {
    throw new TypeError("model operation.options.n must be an integer between 1 and 10");
  }
  const imageUrls = source.imageUrls === undefined ? [] : source.imageUrls;
  if (!Array.isArray(imageUrls) || imageUrls.some((value) => !text(value))) {
    throw new TypeError("model operation.options.imageUrls must be an array of non-empty strings");
  }
  return Object.freeze({
    size: text(source.size),
    resolution: text(source.resolution),
    n: count,
    quality: text(source.quality),
    imageUrls: Object.freeze(imageUrls.map((value) => String(value).trim())),
  });
}

export function normalizeModelOperation(input = {}) {
  const source = requirePlainObject(
    input && typeof input === "object" ? input : {},
    "model operation",
  );
  rejectUnknownKeys(source, ["kind", "input", "options"], "model operation");
  const kind = (text(source.kind) || MODEL_OPERATION_KIND.CHAT).toLowerCase();
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
      input: Object.freeze({
        query: requireText(operationInput.query, "model operation.input.query"),
      }),
      options: Object.freeze({}),
    });
  }
  if (kind === MODEL_OPERATION_KIND.MULTIMODAL_PARSE) {
    rejectUnknownKeys(operationInput, ["prompt", "attachments"], "model operation.input");
    if (!Array.isArray(operationInput.attachments) || operationInput.attachments.length === 0) {
      throw new TypeError("model operation.input.attachments must be a non-empty array");
    }
    const attachments = operationInput.attachments.map((value, index) => {
      const attachmentPath = `model operation.input.attachments[${index}]`;
      const attachment = requirePlainObject(value, attachmentPath);
      rejectUnknownKeys(attachment, ["mimeType", "data", "fileName"], attachmentPath);
      const mimeType = requireText(attachment.mimeType, `${attachmentPath}.mimeType`);
      if (classifyModelInputProcessing(mimeType).kind === MODEL_INPUT_PROCESSING_KIND.DIRECT_TEXT) {
        throw new TypeError(`${attachmentPath}.mimeType is directly readable text: ${mimeType}`);
      }
      return Object.freeze({
        mimeType,
        data: requireText(attachment.data, `${attachmentPath}.data`),
        fileName: text(attachment.fileName),
      });
    });
    return Object.freeze({
      kind,
      input: Object.freeze({
        prompt: requireText(operationInput.prompt, "model operation.input.prompt"),
        attachments: Object.freeze(attachments),
      }),
      options: Object.freeze({}),
    });
  }
  rejectUnknownKeys(operationInput, ["prompt"], "model operation.input");
  return Object.freeze({
    kind,
    input: Object.freeze({
      prompt: requireText(operationInput.prompt, "model operation.input.prompt"),
    }),
    options: normalizeImageOptions(operationOptions),
  });
}

function normalizeImageArtifact(value, index) {
  const path = `model response.result.imageArtifacts[${index}]`;
  const artifact = requirePlainObject(value, path);
  rejectUnknownKeys(artifact, ["fileName", "b64Json", "url"], path);
  const b64Json = text(artifact.b64Json);
  const url = text(artifact.url);
  if (!b64Json && !url) throw new TypeError(`${path} requires b64Json or url`);
  return Object.freeze({
    fileName: requireText(artifact.fileName, `${path}.fileName`),
    b64Json,
    url,
  });
}

function normalizeWebSearchSource(value = {}, path = "") {
  const source = requirePlainObject(value, path);
  rejectUnknownKeys(source, ["title", "url"], path);
  return Object.freeze({
    title: text(source.title),
    url: requireText(source.url, `${path}.url`),
  });
}

export function normalizeModelOperationResult(kind, input = {}) {
  const operationKind = text(kind).toLowerCase();
  if (!OPERATION_KINDS.has(operationKind)) {
    throw new TypeError(`unsupported model operation result: ${operationKind || "missing"}`);
  }
  const source = requirePlainObject(input, "model response.result");
  if (operationKind === MODEL_OPERATION_KIND.CHAT) {
    rejectUnknownKeys(source, [], "model response.result");
    return Object.freeze({});
  }
  if (operationKind === MODEL_OPERATION_KIND.WEB_SEARCH) {
    rejectUnknownKeys(source, ["rawText", "sources"], "model response.result");
    if (!Array.isArray(source.sources))
      throw new TypeError("model response.result.sources must be an array");
    return Object.freeze({
      rawText: text(source.rawText),
      sources: Object.freeze(
        source.sources.map((item, index) =>
          normalizeWebSearchSource(item, `model response.result.sources[${index}]`),
        ),
      ),
    });
  }
  if (operationKind === MODEL_OPERATION_KIND.MULTIMODAL_PARSE) {
    rejectUnknownKeys(source, ["rawText", "output"], "model response.result");
    return Object.freeze({
      rawText: text(source.rawText),
      output: Array.isArray(source.output) ? Object.freeze([...source.output]) : Object.freeze([]),
    });
  }
  rejectUnknownKeys(
    source,
    ["rawText", "imageArtifacts", "output", "taskId", "rawTask"],
    "model response.result",
  );
  if (!Array.isArray(source.imageArtifacts)) {
    throw new TypeError("model response.result.imageArtifacts must be an array");
  }
  if (source.output !== undefined && !Array.isArray(source.output)) {
    throw new TypeError("model response.result.output must be an array");
  }
  if (source.rawTask !== undefined)
    requirePlainObject(source.rawTask, "model response.result.rawTask");
  return Object.freeze({
    rawText: text(source.rawText),
    imageArtifacts: Object.freeze(source.imageArtifacts.map(normalizeImageArtifact)),
    output: Object.freeze([...(source.output || [])]),
    taskId: text(source.taskId),
    ...(source.rawTask === undefined ? {} : { rawTask: Object.freeze({ ...source.rawTask }) }),
  });
}
