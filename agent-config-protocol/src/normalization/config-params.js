/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

import { isPlainObject } from "../utils.js";
import { AgentConfigProtocolError, CONFIG_ERROR_CODE } from "../contract/errors.js";

const CONFIG_PARAM_KEY_PATTERN = /^[A-Z0-9_]+$/;

export function normalizeConfigParamKey(value = "") {
  return String(value || "")
    .trim()
    .toUpperCase();
}

function normalizeConfigParamMap(input, { field, omitEmptyValues }) {
  if (!isPlainObject(input)) {
    throw new AgentConfigProtocolError(`config params ${field} must be an object`, {
      code: CONFIG_ERROR_CODE.INVALID_PARAM_DOCUMENT,
      details: { field },
    });
  }
  const normalized = {};
  const sourceKeys = new Map();
  for (const [rawKey, rawValue] of Object.entries(input)) {
    const key = normalizeConfigParamKey(rawKey);
    const value = String(rawValue ?? "").trim();
    if (!CONFIG_PARAM_KEY_PATTERN.test(key)) {
      throw new AgentConfigProtocolError(`invalid config param key: ${rawKey}`, {
        code: CONFIG_ERROR_CODE.INVALID_PARAM_DOCUMENT,
        details: { field, key: rawKey },
      });
    }
    if (sourceKeys.has(key) && sourceKeys.get(key) !== rawKey) {
      throw new AgentConfigProtocolError(`ambiguous config param key: ${key}`, {
        code: CONFIG_ERROR_CODE.INVALID_PARAM_DOCUMENT,
        details: { field, key, sourceKeys: [sourceKeys.get(key), rawKey] },
      });
    }
    sourceKeys.set(key, rawKey);
    if (omitEmptyValues && !value) continue;
    normalized[key] = value;
  }
  return normalized;
}

export function normalizeConfigParamValues(input = {}) {
  return normalizeConfigParamMap(input, { field: "values", omitEmptyValues: false });
}

export function normalizeConfigParamDescriptions(input = {}) {
  return normalizeConfigParamMap(input, { field: "descriptions", omitEmptyValues: false });
}

export function normalizeConfigParamsDocument(document = {}) {
  if (!isPlainObject(document)) {
    throw new AgentConfigProtocolError("config params document must be an object", {
      code: CONFIG_ERROR_CODE.INVALID_PARAM_DOCUMENT,
    });
  }
  const unknownFields = Object.keys(document).filter(
    (field) => field !== "values" && field !== "descriptions",
  );
  if (unknownFields.length) {
    throw new AgentConfigProtocolError(
      `unknown config params document field: ${unknownFields[0]}`,
      {
        code: CONFIG_ERROR_CODE.INVALID_PARAM_DOCUMENT,
        details: { fields: unknownFields },
      },
    );
  }
  const values = normalizeConfigParamValues(document.values || {});
  const descriptions = normalizeConfigParamDescriptions(document.descriptions || {});
  for (const key of Object.keys(values)) {
    if (!Object.prototype.hasOwnProperty.call(descriptions, key)) descriptions[key] = "";
  }
  return { values, descriptions };
}

export function mergeConfigParamLayers(...layers) {
  return Object.assign(
    {},
    ...layers.map((layer) =>
      Object.fromEntries(
        Object.entries(normalizeConfigParamValues(layer)).filter(([, value]) => Boolean(value)),
      ),
    ),
  );
}

function normalizeExplicitConfigParamKeys(keys = []) {
  const normalizedKeys = (Array.isArray(keys) ? keys : []).map(normalizeConfigParamKey);
  for (const key of normalizedKeys) {
    if (!CONFIG_PARAM_KEY_PATTERN.test(key)) {
      throw new AgentConfigProtocolError(`invalid config param key: ${key}`, {
        code: CONFIG_ERROR_CODE.INVALID_PARAM_DOCUMENT,
        details: { field: "keys", key },
      });
    }
  }
  return Array.from(new Set(normalizedKeys));
}

export function assertConfigParamsDocumentKeys(document = {}, keys = []) {
  const normalizedDocument = normalizeConfigParamsDocument(document);
  const allowedKeys = new Set(normalizeExplicitConfigParamKeys(keys));
  const documentKeys = new Set([
    ...Object.keys(normalizedDocument.values),
    ...Object.keys(normalizedDocument.descriptions),
  ]);
  const unknownKeys = Array.from(documentKeys)
    .filter((key) => !allowedKeys.has(key))
    .sort((left, right) => left.localeCompare(right));
  if (unknownKeys.length) {
    throw new AgentConfigProtocolError(`unknown config param key: ${unknownKeys[0]}`, {
      code: CONFIG_ERROR_CODE.INVALID_PARAM_DOCUMENT,
      details: { field: "values", keys: unknownKeys },
    });
  }
  return normalizedDocument;
}

export function synchronizeConfigParamsDocument({ document = {}, keys = [] } = {}) {
  const normalizedDocument = normalizeConfigParamsDocument(document);
  const authoritativeKeys = normalizeExplicitConfigParamKeys(keys).sort((left, right) =>
    left.localeCompare(right),
  );
  return {
    values: Object.fromEntries(
      authoritativeKeys.map((key) => [key, normalizedDocument.values[key] || ""]),
    ),
    descriptions: Object.fromEntries(
      authoritativeKeys.map((key) => [key, normalizedDocument.descriptions[key] || ""]),
    ),
  };
}

export function buildConfigParamCatalog({
  keys = [],
  descriptions = {},
  values = {},
  extraKeys = [],
} = {}) {
  const document = normalizeConfigParamsDocument({ values, descriptions });
  const explicitKeys = normalizeExplicitConfigParamKeys([
    ...(Array.isArray(keys) ? keys : []),
    ...(Array.isArray(extraKeys) ? extraKeys : []),
  ]);
  return Array.from(
    new Set([
      ...explicitKeys,
      ...Object.keys(document.values),
      ...Object.keys(document.descriptions),
    ]),
  )
    .sort((left, right) => left.localeCompare(right))
    .map((key) => ({ key, description: document.descriptions[key] || "" }));
}
