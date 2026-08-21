/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import {
  assertSelectedConnectorsOwned,
  normalizeSelectedConnectorIds,
} from "@noobot/connector-protocol";
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

export function registerConnectorRoutes(app, { bot, connectorRuntime, translateText } = {}) {
  const jsonOptions = { fallbackErrorKey: "common.getConnectorsFailed", translateText };

  app.get("/internal/connectors/catalog", (_req, res) => {
    res.json({ ok: true, catalog: connectorRuntime.listRegisteredInstances() });
  });

  app.get(
    "/internal/connectors/:userId",
    withJsonError(async (req, res) => {
      const userId = assertOwner(req, req.params.userId);
      const connectors = await connectorRuntime.listUserConnectors(userId);
      res.json({ ok: true, userId, connectors });
    }, jsonOptions),
  );

  app.post(
    "/internal/connectors/:userId",
    withJsonError(async (req, res) => {
      const userId = assertOwner(req, req.params.userId);
      const record = await connectorRuntime.createConnector({
        userId,
        name: req.body?.name,
        instanceType: req.body?.instanceType,
        parameters: req.body?.parameters,
      });
      const connection = await connectorRuntime.connect({
        userId,
        connectorId: record.connectorId,
      });
      res.status(201).json({ ok: true, connection });
    }, jsonOptions),
  );

  app.put(
    "/internal/connectors/:userId/:connectorId",
    withJsonError(async (req, res) => {
      const userId = assertOwner(req, req.params.userId);
      const connectorId = String(req.params.connectorId || "").trim();
      const record = await connectorRuntime.updateConnector({
        userId,
        connectorId,
        name: req.body?.name,
        instanceType: req.body?.instanceType,
        parameters: req.body?.parameters,
      });
      if (!record) {
        res.status(404).json({ ok: false, error: "connector_not_found" });
        return;
      }
      const connection = await connectorRuntime.connect({
        userId,
        connectorId,
      });
      res.json({ ok: true, connection });
    }, jsonOptions),
  );

  app.delete(
    "/internal/connectors/:userId/:connectorId",
    withJsonError(async (req, res) => {
      const userId = assertOwner(req, req.params.userId);
      const connectorId = String(req.params.connectorId || "").trim();
      const deleted = await connectorRuntime.deleteConnector({ userId, connectorId });
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
      const connection = await connectorRuntime.connect({
        userId,
        connectorId: req.params.connectorId,
      });
      res.json({ ok: true, connection });
    }, jsonOptions),
  );

  app.post(
    "/internal/connectors/:userId/:connectorId/disconnect",
    withJsonError(async (req, res) => {
      const userId = assertOwner(req, req.params.userId);
      const connectorId = String(req.params.connectorId || "").trim();
      const disconnected = await connectorRuntime.disconnect({ userId, connectorId });
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
      const connectors = await connectorRuntime.listUserConnectors(userId);
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
      const connectors = await connectorRuntime.listUserConnectors(userId);
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
