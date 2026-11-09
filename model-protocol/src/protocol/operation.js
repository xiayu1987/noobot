/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import {
  MODEL_INPUT_PROCESSING_KIND,
  classifyModelInputProcessing,
} from "../model/model-input-processing.js";
import { text } from "@noobot/shared/value";
import { requirePlainObject, rejectUnknownKeys } from "../validation/object.js";
import { normalizeGeneratedMediaArtifact } from "./generated-media.js";
import {
  normalizeGenerationImageUrls,
  normalizeVideoGenerationOptions,
  requireGenerationOptionKeys,
  MODEL_GENERATION_OUTPUT_TYPES,
} from "./generation-options.js";

export const MODEL_OPERATION_KIND = Object.freeze({
  CHAT: "chat",
  WEB_SEARCH: "web_search",
  MEDIA_GENERATION: "media_generation",
  MULTIMODAL_PARSE: "multimodal_parse",
});

export const MODEL_WEB_SEARCH_INSTRUCTION =
  "Search the web before answering. Answer only from the search results.";

const OPERATION_KINDS = new Set(Object.values(MODEL_OPERATION_KIND));

function requireText(value, path) {
  const normalizedText = text(value);
  if (!normalizedText) throw new TypeError(`${path} is required`);
  return normalizedText;
}

function normalizeImageOptions(input = {}) {
  const source = requirePlainObject(input, "model operation.options");
  requireGenerationOptionKeys(source, "image");
  const count = source.n === undefined ? 1 : Number(source.n);
  if (!Number.isInteger(count) || count < 1 || count > 10) {
    throw new TypeError("model operation.options.n must be an integer between 1 and 10");
  }
  return Object.freeze({
    size: text(source.size),
    resolution: text(source.resolution),
    n: count,
    quality: text(source.quality),
    ...(source.complexity === undefined ? {} : { complexity: text(source.complexity) }),
    imageUrls: normalizeGenerationImageUrls(source.imageUrls),
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
  rejectUnknownKeys(operationInput, ["prompt", "outputType"], "model operation.input");
  const outputType = operationInput.outputType;
  if (!MODEL_GENERATION_OUTPUT_TYPES.includes(outputType))
    throw new TypeError("generation outputType must be image or video");
  return Object.freeze({
    kind,
    input: Object.freeze({
      prompt: requireText(operationInput.prompt, "model operation.input.prompt"),
      outputType,
    }),
    options:
      outputType === "video"
        ? normalizeVideoGenerationOptions(operationOptions)
        : normalizeImageOptions(operationOptions),
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
    if (!Array.isArray(source.output))
      throw new TypeError("model response.result.output must be an array");
    return Object.freeze({
      rawText: text(source.rawText),
      output: Object.freeze([...source.output]),
    });
  }
  rejectUnknownKeys(source, ["rawText", "artifacts", "taskId"], "model response.result");
  if (!Array.isArray(source.artifacts) || !source.artifacts.length)
    throw new TypeError("generation result requires non-empty artifacts");
  return Object.freeze({
    rawText: text(source.rawText),
    artifacts: Object.freeze(source.artifacts.map(normalizeGeneratedMediaArtifact)),
    taskId: text(source.taskId),
  });
}
