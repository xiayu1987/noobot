/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { normalizeConnectorType } from "../../../config/index.js";
import { toToolJsonResult } from "../../core/tool-json-result.js";
import { tTool } from "../../core/tool-i18n.js";
import { pickObject } from "./connector-fields.js";
import { matchesSensitiveFieldPattern } from "../../core/sensitive-field-patterns.js";
import { ConnectorType } from "../../constants/index.js";

function tConnector(runtime = {}, key = "", params = {}) {
  const normalizedKey = String(key || "").trim();
  if (!normalizedKey) return "";
  return tTool(runtime, `connectors.access.${normalizedKey}`, params);
}

function maskConnectionInfo(info = {}) {
  const out = { ...pickObject(info) };
  for (const key of Object.keys(out || {})) {
    if (matchesSensitiveFieldPattern(key) && out[key]) {
      out[key] = "***";
    }
  }
  return out;
}

function addRuntimeConnectorChannel(runtime = {}, connector = {}) {
  const normalizedType = String(connector?.connectorType || "")
    .trim()
    .toLowerCase();
  if (
    ![
      ConnectorType.DATABASE,
      ConnectorType.TERMINAL,
      ConnectorType.EMAIL,
    ].includes(normalizedType)
  ) {
    return;
  }
  const bucketKey =
    normalizedType === ConnectorType.DATABASE
      ? ConnectorType.CHANNEL_BUCKET.DATABASE
      : normalizedType === ConnectorType.TERMINAL
        ? ConnectorType.CHANNEL_BUCKET.TERMINAL
        : ConnectorType.CHANNEL_BUCKET.EMAIL;
  const current = pickObject(runtime?.connectorChannels);
  const next = {
    [ConnectorType.CHANNEL_BUCKET.DATABASE]: Array.isArray(
      current?.[ConnectorType.CHANNEL_BUCKET.DATABASE],
    )
      ? [...current[ConnectorType.CHANNEL_BUCKET.DATABASE]]
      : [],
    [ConnectorType.CHANNEL_BUCKET.TERMINAL]: Array.isArray(
      current?.[ConnectorType.CHANNEL_BUCKET.TERMINAL],
    )
      ? [...current[ConnectorType.CHANNEL_BUCKET.TERMINAL]]
      : [],
    [ConnectorType.CHANNEL_BUCKET.EMAIL]: Array.isArray(
      current?.[ConnectorType.CHANNEL_BUCKET.EMAIL],
    )
      ? [...current[ConnectorType.CHANNEL_BUCKET.EMAIL]]
      : [],
  };
  const list = next[bucketKey];
  const targetName = String(connector?.connectorName || "").trim();
  const hitIndex = list.findIndex(
    (item) => String(item?.connectorName || "").trim() === targetName,
  );
  if (hitIndex >= 0) list[hitIndex] = connector;
  else list.push(connector);
  runtime.connectorChannels = next;
}

function upsertRuntimeSelectedConnector(
  runtime = {},
  { connectorType = "", connectorName = "" } = {},
) {
  const normalizedType = normalizeConnectorType(connectorType);
  const normalizedName = String(connectorName || "").trim();
  if (
    ![
      ConnectorType.DATABASE,
      ConnectorType.TERMINAL,
      ConnectorType.EMAIL,
    ].includes(normalizedType)
  ) {
    return;
  }
  if (!normalizedName) return;
  if (!runtime.systemRuntime || typeof runtime.systemRuntime !== "object") {
    runtime.systemRuntime = {};
  }
  if (!runtime.systemRuntime.config || typeof runtime.systemRuntime.config !== "object") {
    runtime.systemRuntime.config = {};
  }
  const currentSelected =
    runtime.systemRuntime.config.selectedConnectors &&
    typeof runtime.systemRuntime.config.selectedConnectors === "object"
      ? runtime.systemRuntime.config.selectedConnectors
      : {};
  runtime.systemRuntime.config.selectedConnectors = {
    ...currentSelected,
    [normalizedType]: normalizedName,
  };
}

function findConnectedConnector({
  store = null,
  rootSessionId = "",
  connectorName = "",
  connectorType = "",
} = {}) {
  if (!store || typeof store.getSessionConnectors !== "function") return null;
  const allConnectors = store.getSessionConnectors(String(rootSessionId || "").trim());
  const bucket =
    String(connectorType || "").trim() === ConnectorType.DATABASE
      ? ConnectorType.CHANNEL_BUCKET.DATABASE
      : String(connectorType || "").trim() === ConnectorType.TERMINAL
        ? ConnectorType.CHANNEL_BUCKET.TERMINAL
        : ConnectorType.CHANNEL_BUCKET.EMAIL;
  const sourceList = Array.isArray(allConnectors?.[bucket]) ? allConnectors[bucket] : [];
  const normalizedName = String(connectorName || "").trim();
  return (
    sourceList.find(
      (item) => String(item?.connectorName || "").trim() === normalizedName,
    ) || null
  );
}

function isUserCancelledInteraction(interactionResult = {}) {
  return Boolean(
    interactionResult &&
      typeof interactionResult === "object" &&
      !Array.isArray(interactionResult) &&
      interactionResult.confirmed === false,
  );
}

function buildAlreadyConnectedResponse(toolName = "", connector = {}, runtime = {}) {
  return toToolJsonResult(toolName, {
    ok: true,
    status: "already_connected",
    connector,
    message: tConnector(runtime, "alreadyConnected"),
  });
}

function buildConnectionStatusPayload({
  runtimeStatus = {},
  connector = {},
  extra = {},
} = {}) {
  return {
    ok: runtimeStatus?.status === "connected",
    status: runtimeStatus?.status || "unknown",
    status_code: Number(runtimeStatus?.status_code ?? 0),
    status_message: String(runtimeStatus?.status_message || ""),
    checked_at: String(runtimeStatus?.checked_at || ""),
    connector,
    ...(pickObject(extra) || {}),
  };
}

function buildRuntimeConnectorStatus({
  runtime = {},
  store,
  rootSessionId,
  connectorName,
  connectorType,
}) {
  return typeof store?.inspectConnectorRuntimeStatus === "function"
    ? store.inspectConnectorRuntimeStatus({
        sessionId: rootSessionId,
        connectorName,
        connectorType,
        timeoutMs: 8000,
      })
    : Promise.resolve({
        connector_name: connectorName,
        connector_type: connectorType,
        status: "unknown",
        status_code: 503,
        status_message: tConnector(runtime, "statusInspectorUnavailable"),
      });
}

export {
  tConnector,
  maskConnectionInfo,
  addRuntimeConnectorChannel,
  upsertRuntimeSelectedConnector,
  findConnectedConnector,
  isUserCancelledInteraction,
  buildAlreadyConnectedResponse,
  buildConnectionStatusPayload,
  buildRuntimeConnectorStatus,
};
