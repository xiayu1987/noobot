/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { registerFileCrudRoutes } from "./file-crud-routes.js";

export function registerConfigAndTemplateRoutes(
  app,
  {
    requireApiKey,
    requireSuperAdmin,
    resolveConfigParamScope,
    readScopedConfigParams,
    writeScopedConfigParams,
    buildScopedConfigParamsResponse,
    normalizeConfigParams,
    readWorkspaceConfigParams,
    readUserConfigParams,
    collectConfigTemplateKeys,
    collectUserConfigTemplateKeys,
    buildConfigParamCatalog,
    rebuildRuntimeConfig,
    templateRootPath,
    buildWorkspaceTree,
    translateText,
  } = {},
) {
  // ── Config params routes (unchanged) ──

  app.get("/internal/config-params", async (req, res) => {
    try {
      const scope = resolveConfigParamScope(req);
      if (scope === "system" && String(req?.auth?.role || "") !== "super_admin") {
        res.status(403).json({
          ok: false,
          error: translateText("common.superAdminRequiredForSystemParams", req.locale),
        });
        return;
      }
      const { payload, userId } = await readScopedConfigParams({
        req,
        createIfMissing: true,
      });
      res.json(await buildScopedConfigParamsResponse({ req, payload, userId }));
    } catch (error) {
      res.status(400).json({
        ok: false,
        error: error.message || translateText("common.readConfigParamsFailed", req.locale),
      });
    }
  });

  app.put("/internal/config-params", async (req, res) => {
    try {
      const scope = resolveConfigParamScope(req);
      if (scope === "system" && String(req?.auth?.role || "") !== "super_admin") {
        res.status(403).json({
          ok: false,
          error: translateText("common.superAdminRequiredForSystemParams", req.locale),
        });
        return;
      }
      const incomingBody = req.body || {};
      const { payload, userId } = await writeScopedConfigParams({
        req,
        values:
          incomingBody?.values && typeof incomingBody.values === "object"
            ? incomingBody.values
            : undefined,
        descriptions:
          incomingBody?.descriptions && typeof incomingBody.descriptions === "object"
            ? incomingBody.descriptions
            : undefined,
      });
      if (scope === "system") await rebuildRuntimeConfig();
      res.json(await buildScopedConfigParamsResponse({ req, payload, userId }));
    } catch (error) {
      res.status(400).json({
        ok: false,
        error: error.message || translateText("common.saveConfigParamsFailed", req.locale),
      });
    }
  });

  app.get("/internal/config-params/catalog", async (req, res) => {
    try {
      const scope = resolveConfigParamScope(req);
      let payload = normalizeConfigParams({});
      if (scope === "system") {
        payload = await readWorkspaceConfigParams({ createIfMissing: true });
      } else {
        const userId = String(req?.auth?.userId || "").trim();
        payload = await readUserConfigParams({ userId, createIfMissing: true });
      }
      const keys =
        scope === "system"
          ? await collectConfigTemplateKeys()
          : await collectUserConfigTemplateKeys(String(req?.auth?.userId || "").trim());
      const catalog = buildConfigParamCatalog({
        keys,
        descriptions: payload?.descriptions || {},
        values: payload?.values || {},
      });
      res.json({ ok: true, scope, catalog });
    } catch (error) {
      res.status(400).json({
        ok: false,
        error:
          error.message || translateText("common.loadConfigParamsCatalogFailed", req.locale),
      });
    }
  });

  app.get("/internal/admin/config-params", requireApiKey, requireSuperAdmin, async (req, res) => {
    try {
      req.query = { ...(req.query || {}), scope: "system" };
      const { payload } = await readScopedConfigParams({ req, createIfMissing: true });
      res.json(await buildScopedConfigParamsResponse({ req, payload }));
    } catch (error) {
      res.status(400).json({
        ok: false,
        error: error.message || translateText("common.readConfigParamsFailed", req.locale),
      });
    }
  });

  app.put("/internal/admin/config-params", requireApiKey, requireSuperAdmin, async (req, res) => {
    try {
      req.query = { ...(req.query || {}), scope: "system" };
      const incomingBody = req.body || {};
      const { payload } = await writeScopedConfigParams({
        req,
        values: incomingBody?.values,
        descriptions: incomingBody?.descriptions,
      });
      await rebuildRuntimeConfig();
      res.json(await buildScopedConfigParamsResponse({ req, payload }));
    } catch (error) {
      res.status(400).json({
        ok: false,
        error: error.message || translateText("common.saveConfigParamsFailed", req.locale),
      });
    }
  });

  // ── Template file CRUD routes via factory ──
  // Note: buildDirectoryArchiveFile is intentionally omitted so that
  // the /download route is NOT registered (matches original behavior).

  registerFileCrudRoutes(app, {
    routePrefix: "/internal/admin/template",
    resolveRootPath: templateRootPath,
    middleware: [requireApiKey, requireSuperAdmin],
    buildWorkspaceTree,
    translateText,
    i18nKeys: {
      treeFailed: "common.loadTemplateTreeFailed",
      readFailed: "common.readTemplateFileFailed",
      saveFailed: "common.saveTemplateFileFailed",
    },
  });
}
