/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 *
 * Model spec normalization and default value resolution.
 */
import { getModelDefaultFields } from "./defaults.js";

/**
 * Normalize model spec input to a consistent object shape.
 * @param {string|object} input
 * @param {object} fallback
 * @returns {object}
 */
export function normalizeModelSpecInput(input, fallback = {}) {
  if (!input) return { ...fallback };
  if (typeof input === "string") return { ...fallback, model: input };
  if (typeof input === "object") return { ...fallback, ...input };
  return { ...fallback };
}

/**
 * Parse a value to a finite number, returning fallback if not finite.
 * @param {*} value
 * @param {number} fallback
 * @returns {number}
 */
export function toFiniteNumber(value, fallback) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return parsed;
}

/**
 * Clamp a number within [min, max].
 * @param {number} value
 * @param {number} min
 * @param {number} max
 * @returns {number}
 */
export function clampNumber(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

/**
 * Normalize a model parameter value with type-specific clamping.
 * @param {string} fieldKey
 * @param {*} value
 * @param {number} fallback
 * @returns {number}
 */
export function normalizeModelParamValue(fieldKey = "", value, fallback) {
  const numericValue = toFiniteNumber(value, fallback);
  if (!Number.isFinite(numericValue)) return fallback;
  if (fieldKey === "temperature") {
    return clampNumber(numericValue, 0, 2);
  }
  if (fieldKey === "top_p") {
    return clampNumber(numericValue, 0.01, 1);
  }
  if (fieldKey === "frequency_penalty" || fieldKey === "presence_penalty") {
    return clampNumber(numericValue, -2, 2);
  }
  if (fieldKey === "thinking_budget") {
    const thinkingBudget = Math.floor(numericValue);
    if (!Number.isFinite(thinkingBudget)) return fallback;
    return clampNumber(thinkingBudget, 0, 131072);
  }
  return numericValue;
}

/**
 * Check if an object has an own property with any value (including undefined).
 * @param {object} spec
 * @param {string} key
 * @returns {boolean}
 */
export function hasOwnValue(spec = {}, key = "") {
  return Object.prototype.hasOwnProperty.call(spec || {}, key);
}

/**
 * Normalize a model spec with format-specific default values.
 * @param {object} modelSpec
 * @returns {object}
 */
export function normalizeModelSpecWithDefaults(modelSpec = {}) {
  const normalized = { ...(modelSpec || {}) };
  const defaultsByFormat = getModelDefaultFields(normalized);
  for (const [fieldKey, defaultValue] of Object.entries(defaultsByFormat)) {
    if (hasOwnValue(normalized, fieldKey)) {
      normalized[fieldKey] = normalizeModelParamValue(
        fieldKey,
        normalized[fieldKey],
        defaultValue,
      );
      continue;
    }
    normalized[fieldKey] = normalizeModelParamValue(
      fieldKey,
      defaultValue,
      defaultValue,
    );
  }

  if (hasOwnValue(normalized, "max_tokens")) {
    const maxTokens = Math.floor(Number(normalized.max_tokens));
    if (Number.isFinite(maxTokens) && maxTokens > 0) {
      normalized.max_tokens = maxTokens;
    } else {
      delete normalized.max_tokens;
    }
  }
  return normalized;
}
