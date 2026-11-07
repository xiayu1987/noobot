/* Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { text } from "@noobot/shared/value";

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
