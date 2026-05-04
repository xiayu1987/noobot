/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import path from "node:path";
import { access, mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { safeJoin } from "../system-core/utils/fs-safe.js";

export function registerConfigAndTemplateRoutes(
  app,
  {
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

  app.get("/internal/admin/config-params", requireSuperAdmin, async (req, res) => {
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

  app.put("/internal/admin/config-params", requireSuperAdmin, async (req, res) => {
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

  app.get("/internal/admin/template/tree", requireSuperAdmin, async (req, res) => {
    try {
      const root = templateRootPath();
      await mkdir(root, { recursive: true });
      const tree = await buildWorkspaceTree(root);
      res.json({ ok: true, root, tree });
    } catch (error) {
      res.status(400).json({
        ok: false,
        error: error.message || translateText("common.loadTemplateTreeFailed", req.locale),
      });
    }
  });

  app.get("/internal/admin/template/file", requireSuperAdmin, async (req, res) => {
    try {
      const relativePath = String(req.query.path || "");
      if (!relativePath) throw new Error(translateText("common.pathRequired", req.locale));
      const root = templateRootPath();
      const absolutePath = safeJoin(root, relativePath);
      await access(absolutePath);
      const fileStats = await stat(absolutePath);
      if (!fileStats.isFile()) throw new Error(translateText("common.pathIsNotFile", req.locale));
      const contentBuffer = await readFile(absolutePath);
      const isText = !contentBuffer.includes(0);
      const content = isText ? contentBuffer.toString("utf8") : "";
      res.json({ ok: true, path: relativePath, isText, size: fileStats.size, content });
    } catch (error) {
      res.status(400).json({
        ok: false,
        error: error.message || translateText("common.readTemplateFileFailed", req.locale),
      });
    }
  });

  app.put("/internal/admin/template/file", requireSuperAdmin, async (req, res) => {
    try {
      const relativePath = String(req.body?.path || "");
      const content = String(req.body?.content || "");
      if (!relativePath) throw new Error(translateText("common.pathRequired", req.locale));
      const root = templateRootPath();
      const absolutePath = safeJoin(root, relativePath);
      await mkdir(path.dirname(absolutePath), { recursive: true });
      await writeFile(absolutePath, content, "utf8");
      res.json({ ok: true, path: relativePath });
    } catch (error) {
      res.status(400).json({
        ok: false,
        error: error.message || translateText("common.saveTemplateFileFailed", req.locale),
      });
    }
  });
}
