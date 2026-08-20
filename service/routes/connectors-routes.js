/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import {
  assertSelectedConnectorsOwned,
  CONNECTOR_CATALOG,
  normalizeSelectedConnectorIds,
  projectPublicConnector,
} from "@noobot/connector-protocol";
import { TIME_THRESHOLDS } from "@noobot/shared/time-thresholds";
import { withJsonError } from "./route-wrapper.js";

function assertOwner(req, userId = "") {
  const authenticatedUserId = String(req?.auth?.userId || "").trim();
  const requestedUserId = String(userId || "").trim();
  if (!authenticatedUserId || authenticatedUserId !== requestedUserId) {
    const error = new Error("connector owner does not match authenticated user");
    error.status = 403;
    error.errorCode = "connector_owner_mismatch";
    throw error;
  }
  return requestedUserId;
}

function runtimeStatusMap(channelStore, userId = "") {
  return new Map(
    channelStore
      .getUserConnectors(userId)
      .map((item) => [String(item.connectorId || "").trim(), item]),
  );
}

async function listPublicConnectors({ registry, channelStore, userId }) {
  const runtimeById = runtimeStatusMap(channelStore, userId);
  return (await registry.list(userId)).map((record) =>
    projectPublicConnector(record, runtimeById.get(record.connectorId)),
  );
}

async function connectRegisteredConnector({ registry, channelStore, userId, connectorId }) {
  const connector = await registry.get({ userId, connectorId });
  if (!connector) {
    const error = new Error("connector not found");
    error.status = 404;
    error.errorCode = "connector_not_found";
    throw error;
  }
  channelStore.disconnectConnector({ userId, connectorId });
  channelStore.connectConnector({ userId, connector });
  const status = await channelStore.inspectConnector({
    userId,
    connectorId,
    timeoutMs: TIME_THRESHOLDS.connectors.serviceInspectTimeoutMs,
  });
  if (status.status !== "connected") channelStore.disconnectConnector({ userId, connectorId });
  return projectPublicConnector(connector, status);
}

async function removeConnectorFromSessionSelections({ bot, userId, connectorId }) {
  const sessionIds = await bot.session.listSessionIds({ userId });
  const visitedRoots = new Set();
  let updatedSessionCount = 0;
  for (const sessionId of sessionIds) {
    const rootSessionId = await bot.session.getRootSessionId({ userId, sessionId });
    if (!rootSessionId || visitedRoots.has(rootSessionId)) continue;
    visitedRoots.add(rootSessionId);
    const selectedConnectorIds = await bot.session.getRootSessionSelectedConnectorIds({
      userId,
      sessionId: rootSessionId,
    });
    if (!selectedConnectorIds.includes(connectorId)) continue;
    await bot.session.setRootSessionSelectedConnectorIds({
      userId,
      sessionId: rootSessionId,
      selectedConnectorIds: selectedConnectorIds.filter((item) => item !== connectorId),
    });
    updatedSessionCount += 1;
  }
  return updatedSessionCount;
}

export function registerConnectorRoutes(
  app,
  { bot, getConnectorChannelStore, getConnectorRegistry, translateText } = {},
) {
  const jsonOptions = { fallbackErrorKey: "common.getConnectorsFailed", translateText };

  app.get("/internal/connectors/catalog", (_req, res) => {
    res.json({ ok: true, catalog: CONNECTOR_CATALOG });
  });

  app.get(
    "/internal/connectors/:userId",
    withJsonError(async (req, res) => {
      const userId = assertOwner(req, req.params.userId);
      const connectors = await listPublicConnectors({
        registry: getConnectorRegistry(),
        channelStore: getConnectorChannelStore(),
        userId,
      });
      res.json({ ok: true, userId, connectors });
    }, jsonOptions),
  );

  app.post(
    "/internal/connectors/:userId",
    withJsonError(async (req, res) => {
      const userId = assertOwner(req, req.params.userId);
      const registry = getConnectorRegistry();
      const record = await registry.create({
        userId,
        name: req.body?.name,
        type: req.body?.type,
        subType: req.body?.subType,
        parameters: req.body?.parameters,
      });
      const connector = await connectRegisteredConnector({
        registry,
        channelStore: getConnectorChannelStore(),
        userId,
        connectorId: record.connectorId,
      });
      res.status(201).json({ ok: true, connector });
    }, jsonOptions),
  );

  app.put(
    "/internal/connectors/:userId/:connectorId",
    withJsonError(async (req, res) => {
      const userId = assertOwner(req, req.params.userId);
      const connectorId = String(req.params.connectorId || "").trim();
      const channelStore = getConnectorChannelStore();
      const registry = getConnectorRegistry();
      const record = await registry.update({
        userId,
        connectorId,
        name: req.body?.name,
        type: req.body?.type,
        subType: req.body?.subType,
        parameters: req.body?.parameters,
      });
      if (!record) {
        res.status(404).json({ ok: false, error: "connector_not_found" });
        return;
      }
      channelStore.disconnectConnector({ userId, connectorId });
      const connector = await connectRegisteredConnector({
        registry,
        channelStore,
        userId,
        connectorId,
      });
      res.json({ ok: true, connector });
    }, jsonOptions),
  );

  app.delete(
    "/internal/connectors/:userId/:connectorId",
    withJsonError(async (req, res) => {
      const userId = assertOwner(req, req.params.userId);
      const connectorId = String(req.params.connectorId || "").trim();
      getConnectorChannelStore().disconnectConnector({ userId, connectorId });
      const deleted = await getConnectorRegistry().delete({ userId, connectorId });
      if (!deleted) {
        res.status(404).json({ ok: false, error: "connector_not_found" });
        return;
      }
      const updatedSessionCount = await removeConnectorFromSessionSelections({
        bot,
        userId,
        connectorId,
      });
      res.json({ ok: true, connectorId, updatedSessionCount });
    }, jsonOptions),
  );

  app.post(
    "/internal/connectors/:userId/:connectorId/connect",
    withJsonError(async (req, res) => {
      const userId = assertOwner(req, req.params.userId);
      const connector = await connectRegisteredConnector({
        registry: getConnectorRegistry(),
        channelStore: getConnectorChannelStore(),
        userId,
        connectorId: req.params.connectorId,
      });
      res.json({ ok: true, connector });
    }, jsonOptions),
  );

  app.post(
    "/internal/connectors/:userId/:connectorId/disconnect",
    withJsonError(async (req, res) => {
      const userId = assertOwner(req, req.params.userId);
      const connectorId = String(req.params.connectorId || "").trim();
      const disconnected = getConnectorChannelStore().disconnectConnector({ userId, connectorId });
      const updatedSessionCount = await removeConnectorFromSessionSelections({
        bot,
        userId,
        connectorId,
      });
      res.json({ ok: true, connectorId, disconnected, updatedSessionCount });
    }, jsonOptions),
  );

  app.get(
    "/internal/connectors/:userId/sessions/:sessionId",
    withJsonError(async (req, res) => {
      const userId = assertOwner(req, req.params.userId);
      const selectedConnectorIds = await bot.session.getRootSessionSelectedConnectorIds({
        userId,
        sessionId: req.params.sessionId,
      });
      const connectors = await listPublicConnectors({
        registry: getConnectorRegistry(),
        channelStore: getConnectorChannelStore(),
        userId,
      });
      res.json({
        ok: true,
        userId,
        sessionId: req.params.sessionId,
        connectors,
        selectedConnectorIds,
      });
    }, jsonOptions),
  );

  app.put(
    "/internal/connectors/:userId/sessions/:sessionId/selection",
    withJsonError(async (req, res) => {
      const userId = assertOwner(req, req.params.userId);
      const connectors = await listPublicConnectors({
        registry: getConnectorRegistry(),
        channelStore: getConnectorChannelStore(),
        userId,
      });
      const selectedConnectorIds = assertSelectedConnectorsOwned(
        normalizeSelectedConnectorIds(req.body?.selectedConnectorIds),
        connectors,
      );
      const connectedIds = new Set(
        connectors.filter((item) => item.status === "connected").map((item) => item.connectorId),
      );
      const disconnectedSelection = selectedConnectorIds.filter((item) => !connectedIds.has(item));
      if (disconnectedSelection.length) {
        const error = new Error(
          `selected connector is not connected: ${disconnectedSelection.join(", ")}`,
        );
        error.status = 409;
        error.errorCode = "connector_not_connected";
        throw error;
      }
      const savedSelectedConnectorIds = await bot.session.setRootSessionSelectedConnectorIds({
        userId,
        sessionId: req.params.sessionId,
        selectedConnectorIds,
      });
      res.json({
        ok: true,
        userId,
        sessionId: req.params.sessionId,
        selectedConnectorIds: savedSelectedConnectorIds,
      });
    }, jsonOptions),
  );
}
