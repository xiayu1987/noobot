/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { pickObject } from "./connector-fields.js";

function normalizeLookupKey(input = "") {
  return String(input || "")
    .trim()
    .toLowerCase()
    .replace(/[\s\-]+/g, "_");
}

function resolveConnectorFromMapByName(connectorMap = {}, connectorName = "") {
  const normalizedMap = pickObject(connectorMap);
  const targetName = String(connectorName || "").trim();
  if (!targetName) return {};
  const exactValue = pickObject(normalizedMap[targetName]);
  if (Object.keys(exactValue).length) return exactValue;
  const normalizedTargetName = normalizeLookupKey(targetName);
  for (const [mapKey, mapValue] of Object.entries(normalizedMap)) {
    if (normalizeLookupKey(mapKey) !== normalizedTargetName) continue;
    const candidate = pickObject(mapValue);
    if (Object.keys(candidate).length) return candidate;
  }
  return {};
}

function resolveConnectorFallbackFromMap(connectorMap = {}) {
  const normalizedMap = pickObject(connectorMap);
  const defaultKeys = ["default", "默认", "connector_default"];
  for (const defaultKey of defaultKeys) {
    const value = resolveConnectorFromMapByName(normalizedMap, defaultKey);
    if (Object.keys(value).length) return value;
  }
  const entries = Object.entries(normalizedMap).filter(([, mapValue]) =>
    Object.keys(pickObject(mapValue)).length > 0,
  );
  return entries.length === 1 ? pickObject(entries[0][1]) : {};
}

function collectConnectorMapsByType({
  effectiveConfig = {},
  connectorType = "",
} = {}) {
  const normalizedType = String(connectorType || "").trim().toLowerCase();
  const connectorToolConfigKey =
    normalizedType === "database"
      ? "database_connect_connector"
      : normalizedType === "terminal"
        ? "terminal_connect_connector"
        : normalizedType === "email"
          ? "email_connect_connector"
          : "";
  const scopedConnectorMap = pickObject(
    connectorToolConfigKey
      ? effectiveConfig?.tools?.[connectorToolConfigKey]?.connectors
      : {},
  );
  return [{ connectorMap: scopedConnectorMap, allowFallback: true }];
}

function mergeConnectionInfo(base = {}, patch = {}) {
  return { ...pickObject(base), ...pickObject(patch) };
}

function resolveConfiguredConnectorInfo({
  effectiveConfig = {},
  connectorName = "",
  connectorType = "",
} = {}) {
  const connectorMaps = collectConnectorMapsByType({
    effectiveConfig,
    connectorType,
  });
  let resolvedInfo = {};
  for (const connectorMapItem of connectorMaps) {
    const connectorMap = pickObject(connectorMapItem?.connectorMap);
    const exactInfo = resolveConnectorFromMapByName(connectorMap, connectorName);
    if (Object.keys(exactInfo).length) {
      resolvedInfo = mergeConnectionInfo(resolvedInfo, exactInfo);
      continue;
    }
    if (connectorMapItem?.allowFallback !== true) continue;
    const fallbackInfo = resolveConnectorFallbackFromMap(connectorMap);
    if (Object.keys(fallbackInfo).length) {
      resolvedInfo = mergeConnectionInfo(resolvedInfo, fallbackInfo);
    }
  }
  return resolvedInfo;
}

export {
  normalizeLookupKey,
  resolveConnectorFromMapByName,
  resolveConnectorFallbackFromMap,
  collectConnectorMapsByType,
  mergeConnectionInfo,
  resolveConfiguredConnectorInfo,
};
