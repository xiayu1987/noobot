/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import {
  assertSelectedConnectorsOwned,
  normalizeSelectedConnectorIds,
} from "@noobot/connector-protocol";
import express from "express";
import { decodeRequestInput, withJsonError } from "./route-wrapper.js";
import { isFunction, text } from "@noobot/shared/value";

async function removeConnectorFromSessionSelections({ bot, userId, connectorId }) {
  const sessionIds = await bot.session.listSessionIds({ userId });
  const visitedRoots = new Set();
  let updatedSessionCount = 0;
  for (const sessionId of sessionIds) {
    const rootSessionId = await bot.session.getRootSessionId({ userId, sessionId });
    if (visitedRoots.has(rootSessionId)) continue;
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

function registerConnectorSelectionRoutes(router, { bot, connectorRuntime, jsonOptions }) {
  router.get(
    "/:userId/sessions/:sessionId",
    withJsonError(async (req, res) => {
      const userId = text(req.params.userId);
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

  router.put(
    "/:userId/sessions/:sessionId/selection",
    withJsonError(async (req, res) => {
      const userId = text(req.params.userId);
      const connectors = await connectorRuntime.listUserConnectors(userId);
      const selectedConnectorIds = decodeRequestInput(() =>
        assertSelectedConnectorsOwned(
          normalizeSelectedConnectorIds(req.body?.selectedConnectorIds),
          connectors,
        ),
      );
      const connectedIds = new Set(
        connectors.filter((item) => item.status === "connected").map((item) => item.connectorId),
      );
      const disconnectedSelection = selectedConnectorIds.filter((item) => !connectedIds.has(item));
      if (disconnectedSelection.length) {
        const error = new Error(
          `selected connector is not connected: ${disconnectedSelection.join(", ")}`,
        );
        error.statusCode = 409;
        error.code = "connector_not_connected";
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

export function registerConnectorRoutes(
  app,
  { bot, connectorRuntime, translateText, ownerOnlyUserScopeParam } = {},
) {
  if (!isFunction(ownerOnlyUserScopeParam))
    throw new TypeError("connector routes require an ownerOnlyUserScopeParam guard");
  const jsonOptions = { fallbackErrorKey: "common.getConnectorsFailed", translateText };
  const router = express.Router();
  router.param("userId", ownerOnlyUserScopeParam);

  router.get("/catalog", (_req, res) => {
    res.json({ ok: true, catalog: connectorRuntime.listRegisteredInstances() });
  });

  router.get(
    "/:userId",
    withJsonError(async (req, res) => {
      const userId = text(req.params.userId);
      const connectors = await connectorRuntime.listUserConnectors(userId);
      res.json({ ok: true, userId, connectors });
    }, jsonOptions),
  );

  router.post(
    "/:userId",
    withJsonError(async (req, res) => {
      const userId = text(req.params.userId);
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

  router.put(
    "/:userId/:connectorId",
    withJsonError(async (req, res) => {
      const userId = text(req.params.userId);
      const connectorId = text(req.params.connectorId);
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

  router.delete(
    "/:userId/:connectorId",
    withJsonError(async (req, res) => {
      const userId = text(req.params.userId);
      const connectorId = text(req.params.connectorId);
      const connectorExists = (await connectorRuntime.listUserConnectors(userId)).some(
        (connector) => connector.connectorId === connectorId,
      );
      const updatedSessionCount = await removeConnectorFromSessionSelections({
        bot,
        userId,
        connectorId,
      });
      const deleted = connectorExists
        ? await connectorRuntime.deleteConnector({ userId, connectorId })
        : false;
      const connectors = await connectorRuntime.listUserConnectors(userId);
      res.json({ ok: true, userId, connectorId, deleted, updatedSessionCount, connectors });
    }, jsonOptions),
  );

  router.post(
    "/:userId/:connectorId/connect",
    withJsonError(async (req, res) => {
      const userId = text(req.params.userId);
      const connection = await connectorRuntime.connect({
        userId,
        connectorId: req.params.connectorId,
      });
      res.json({ ok: true, connection });
    }, jsonOptions),
  );

  router.post(
    "/:userId/:connectorId/disconnect",
    withJsonError(async (req, res) => {
      const userId = text(req.params.userId);
      const connectorId = text(req.params.connectorId);
      const disconnected = await connectorRuntime.disconnect({ userId, connectorId });
      const updatedSessionCount = await removeConnectorFromSessionSelections({
        bot,
        userId,
        connectorId,
      });
      res.json({ ok: true, connectorId, disconnected, updatedSessionCount });
    }, jsonOptions),
  );

  registerConnectorSelectionRoutes(router, { bot, connectorRuntime, jsonOptions });
  app.use("/internal/connectors", router);
}
