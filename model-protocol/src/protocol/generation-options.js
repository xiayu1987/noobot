/* Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { text } from "@noobot/shared/value";
import { MODEL_GENERATION_API_TYPE } from "../model/model-capabilities.js";

const PIXEL_SIZE = Object.freeze({
  pattern: /^(auto|[1-9]\d*x[1-9]\d*)$/,
  description: "auto or an explicit pixel size such as 1024x1024",
});
const ASPECT_RATIO_SIZE = Object.freeze({
  pattern: /^[1-9]\d*:[1-9]\d*$/,
  description: "an aspect ratio such as 16:9",
});
const DASHSCOPE_SIZE = Object.freeze({
  pattern: /^([1-9]\d*[x*][1-9]\d*|[124]K)$/,
  description: "pixels such as 1024x1024 or a resolution such as 2K",
});
const IMAGE_SIZE_RULES = Object.freeze({
  [MODEL_GENERATION_API_TYPE.OPENAI_IMAGES]: PIXEL_SIZE,
  [MODEL_GENERATION_API_TYPE.XAI_IMAGES]: ASPECT_RATIO_SIZE,
  [MODEL_GENERATION_API_TYPE.GEMINI_INTERACTIONS]: ASPECT_RATIO_SIZE,
  [MODEL_GENERATION_API_TYPE.GEMINI_GENERATE_CONTENT]: ASPECT_RATIO_SIZE,
  [MODEL_GENERATION_API_TYPE.DASHSCOPE_MULTIMODAL]: DASHSCOPE_SIZE,
});

export function describeImageGenerationSizes() {
  return Object.entries(IMAGE_SIZE_RULES)
    .map(([apiType, rule]) => `${apiType}: ${rule.description}`)
    .join("; ");
}

export function requireModelGenerationSize(apiType, operation) {
  if (operation.input.outputType !== "image") return;
  const rule = IMAGE_SIZE_RULES[apiType];
  if (!rule) throw new TypeError(`unsupported image generation API type: ${apiType}`);
  const { size, resolution } = operation.options;
  if (apiType === MODEL_GENERATION_API_TYPE.DASHSCOPE_MULTIMODAL && size && resolution)
    throw new TypeError("DashScope images accept size or resolution, not both");
  const value =
    apiType === MODEL_GENERATION_API_TYPE.DASHSCOPE_MULTIMODAL ? size || resolution : size;
  if (value && !rule.pattern.test(value))
    throw new TypeError(`${apiType} size must be ${rule.description}`);
}

export const MODEL_GENERATION_OPTION_FIELDS = Object.freeze({
  image: Object.freeze({
    size: "size",
    resolution: "resolution",
    n: "n",
    quality: "quality",
    image_urls: "imageUrls",
    complexity: "complexity",
  }),
  video: Object.freeze({
    duration: "duration",
    aspect_ratio: "aspectRatio",
    resolution: "resolution",
    image_urls: "imageUrls",
  }),
});
export const MODEL_GENERATION_OUTPUT_TYPES = Object.freeze(
  Object.keys(MODEL_GENERATION_OPTION_FIELDS),
);

export function requireGenerationOptionKeys(source, outputType) {
  const allowed = new Set(Object.values(MODEL_GENERATION_OPTION_FIELDS[outputType]));
  for (const key of Object.keys(source)) {
    if (!allowed.has(key))
      throw new TypeError(`unsupported ${outputType} generation option: ${key}`);
  }
}

export function normalizeGenerationImageUrls(value = []) {
  if (!Array.isArray(value) || value.some((item) => !text(item)))
    throw new TypeError("model operation.options.imageUrls must contain non-empty strings");
  return Object.freeze(value.map((item) => text(item)));
}

export function normalizeVideoGenerationOptions(source) {
  requireGenerationOptionKeys(source, "video");
  const duration = source.duration;
  if (duration !== undefined && (!Number.isInteger(duration) || duration < 1))
    throw new TypeError("video duration must be a positive integer");
  const aspectRatio = text(source.aspectRatio);
  if (aspectRatio && !/^[1-9]\d*:[1-9]\d*$/.test(aspectRatio))
    throw new TypeError("video aspectRatio must use width:height notation");
  return Object.freeze({
    ...(duration === undefined ? {} : { duration }),
    aspectRatio,
    resolution: text(source.resolution),
    imageUrls: normalizeGenerationImageUrls(source.imageUrls),
  });
}
