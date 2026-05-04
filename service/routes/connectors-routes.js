/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

const DEFAULT_LOCALE = "zh-CN";

function normalizeHistoryConnectorItems(
  items = [],
  locale = DEFAULT_LOCALE,
  translateText = () => "",
) {
  return (Array.isArray(items) ? items : []).map((connectorItem) => ({
    connector_name: String(connectorItem?.connector_name || "").trim(),
    connector_type: String(connectorItem?.connector_type || "").trim(),
    connected_at: String(connectorItem?.last_connected_at || "").trim(),
    connection_meta:
      connectorItem?.connection_meta && typeof connectorItem.connection_meta === "object"
        ? connectorItem.connection_meta
        : {},
    status: String(connectorItem?.status || "disconnected").trim() || "disconnected",
    status_code: Number(connectorItem?.status_code ?? 410),
    status_message:
      String(connectorItem?.status_message || "").trim() ||
      translateText("status.disconnectedFromHistory", locale),
    checked_at:
      String(connectorItem?.checked_at || connectorItem?.last_connected_at || "").trim(),
    last_connected_at: String(connectorItem?.last_connected_at || "").trim(),
    connect_count: Number(connectorItem?.connect_count || 0),
    connection_defaults:
      connectorItem?.connection_defaults &&
      typeof connectorItem.connection_defaults === "object"
        ? connectorItem.connection_defaults
        : {},
  }));
}

function mergeRuntimeAndHistoryConnectorGroup({
  runtimeConnectors = [],
  historyConnectors = [],
  locale = DEFAULT_LOCALE,
  translateText = () => "",
} = {}) {
  const runtimeList = Array.isArray(runtimeConnectors) ? runtimeConnectors : [];
  const historyList = normalizeHistoryConnectorItems(
    historyConnectors,
    locale,
    translateText,
  );
  const mergedByName = new Map();
  for (const historyItem of historyList) {
    const connectorName = String(historyItem?.connector_name || "").trim();
    if (!connectorName) continue;
    mergedByName.set(connectorName, historyItem);
  }
  for (const runtimeItem of runtimeList) {
    const connectorName = String(runtimeItem?.connector_name || "").trim();
    if (!connectorName) continue;
    const previousItem = mergedByName.get(connectorName) || {};
    mergedByName.set(connectorName, {
      ...previousItem,
      ...runtimeItem,
      status: String(runtimeItem?.status || "connected").trim() || "connected",
      status_code: Number(runtimeItem?.status_code ?? 0),
      status_message: String(runtimeItem?.status_message || "ok").trim(),
      checked_at:
        String(runtimeItem?.checked_at || runtimeItem?.connected_at || "").trim() ||
        String(previousItem?.checked_at || "").trim(),
      last_connected_at:
        String(runtimeItem?.connected_at || "").trim() ||
        String(previousItem?.last_connected_at || "").trim(),
    });
  }
  return Array.from(mergedByName.values()).sort((leftConnector, rightConnector) => {
    const leftTime = new Date(
      leftConnector?.last_connected_at || leftConnector?.checked_at || 0,
    ).getTime();
    const rightTime = new Date(
      rightConnector?.last_connected_at || rightConnector?.checked_at || 0,
    ).getTime();
    return rightTime - leftTime;
  });
}

export function registerConnectorRoutes(
  app,
  {
    bot,
    getConnectorChannelStore,
    getConnectorHistoryStore,
    normalizeSelectedConnectors,
    translateText,
  } = {},
) {
  app.get("/internal/connectors/:userId/:sessionId", async (req, res) => {
    try {
      const { userId, sessionId } = req.params;
      const rootSessionId = await bot.session.getRootSessionId({ userId, sessionId });
      const connectorChannelStore = getConnectorChannelStore();
      const connectorHistoryStore = getConnectorHistoryStore();
      const inspectedConnectors = await connectorChannelStore.inspectSessionConnectors({
        sessionId: rootSessionId,
        timeoutMs: 6000,
      });
      const historyConnectors =
        connectorHistoryStore &&
        typeof connectorHistoryStore.listSessionConnectors === "function"
          ? await connectorHistoryStore.listSessionConnectors({
              userId,
              sessionId: rootSessionId,
            })
          : { database: [], terminal: [], email: [] };
      const mergedDatabases = mergeRuntimeAndHistoryConnectorGroup({
        runtimeConnectors: inspectedConnectors?.connectors?.databases || [],
        historyConnectors: historyConnectors?.database || [],
        locale: req.locale,
        translateText,
      });
      const mergedTerminals = mergeRuntimeAndHistoryConnectorGroup({
        runtimeConnectors: inspectedConnectors?.connectors?.terminals || [],
        historyConnectors: historyConnectors?.terminal || [],
        locale: req.locale,
        translateText,
      });
      const mergedEmails = mergeRuntimeAndHistoryConnectorGroup({
        runtimeConnectors: inspectedConnectors?.connectors?.emails || [],
        historyConnectors: historyConnectors?.email || [],
        locale: req.locale,
        translateText,
      });
      const allMergedConnectors = [
        ...mergedDatabases,
        ...mergedTerminals,
        ...mergedEmails,
      ];
      const selectedConnectors = await bot.session.getRootSessionSelectedConnectors({
        userId,
        sessionId: rootSessionId || sessionId,
      });
      res.json({
        ok: true,
        userId,
        sessionId,
        rootSessionId,
        connectors: {
          databases: mergedDatabases,
          terminals: mergedTerminals,
          emails: mergedEmails,
        },
        summary: {
          total_count: allMergedConnectors.length,
          connected_count: allMergedConnectors.filter(
            (connectorItem) => String(connectorItem?.status || "") === "connected",
          ).length,
          error_count: allMergedConnectors.filter(
            (connectorItem) => String(connectorItem?.status || "") === "error",
          ).length,
          unknown_count: allMergedConnectors.filter(
            (connectorItem) => String(connectorItem?.status || "") === "unknown",
          ).length,
        },
        selectedConnectors,
      });
    } catch (error) {
      res.status(400).json({
        ok: false,
        error:
          error.message ||
          translateText("common.getConnectorsFailed", req.locale),
      });
    }
  });

  app.put("/internal/connectors/:userId/:sessionId/selection", async (req, res) => {
    try {
      const { userId, sessionId } = req.params;
      const selectedConnectors = normalizeSelectedConnectors(
        req.body?.selectedConnectors,
      );
      const rootSessionId = await bot.session.getRootSessionId({ userId, sessionId });
      const savedSelectedConnectors = await bot.session.setRootSessionSelectedConnectors({
        userId,
        sessionId: rootSessionId || sessionId,
        selectedConnectors,
      });
      res.json({
        ok: true,
        userId,
        sessionId,
        rootSessionId,
        selectedConnectors: savedSelectedConnectors,
      });
    } catch (error) {
      res.status(400).json({
        ok: false,
        error:
          error.message ||
          translateText("common.saveSelectedConnectorsFailed", req.locale),
      });
    }
  });
}

