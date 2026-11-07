/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import test from "node:test";
import assert from "node:assert/strict";
import express from "express";
import os from "node:os";
import path from "node:path";
import { access, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { registerConfigAndTemplateRoutes } from "../../routes/config-template-routes.js";
import { createConfigParamsService } from "../../services/config-params-service.js";
import { createConfigScopeService } from "../../services/config-scope-service.js";
import { withTestServer } from "./session-routes.helpers.js";

for (const [endpoint, scope] of [
  ["/internal/config-params?scope=user", "user"],
  ["/internal/config-params?scope=system", "system"],
  ["/internal/admin/config-params", "system"],
]) {
  test(`config params HTTP save rejects invalid input without writing and recovers: ${endpoint}`, async (t) => {
    const workspaceRoot = await mkdtemp(path.join(os.tmpdir(), "params-route-"));
    t.after(() => rm(workspaceRoot, { recursive: true, force: true }));
    await mkdir(path.join(workspaceRoot, "admin"));
    await writeFile(path.join(workspaceRoot, "admin/config.json"), "{}");
    const params = createConfigParamsService({
      workspaceRootPath: () => workspaceRoot,
      getGlobalConfigRaw: () => ({}),
    });
    const translateText = (key) => key;
    const scoped = createConfigScopeService({ ...params, translateText });
    let rebuilds = 0;
    const app = express();
    app.use(express.json());
    app.use((req, _res, next) => {
      req.auth = { userId: "admin", role: "super_admin" };
      next();
    });
    registerConfigAndTemplateRoutes(app, {
      ...params,
      ...scoped,
      translateText,
      requireApiKey: (_req, _res, next) => next(),
      requireSuperAdmin: (_req, _res, next) => next(),
      rebuildRuntimeConfig: async () => {
        rebuilds += 1;
      },
    });
    const filePath = path.join(
      workspaceRoot,
      scope === "user" ? "admin" : "",
      "config-params.json",
    );
    await withTestServer(app, async (baseUrl) => {
      const save = (body) =>
        fetch(`${baseUrl}${endpoint}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });
      for (const field of ["values", "descriptions"]) {
        for (const value of [null, false, 0, "", [], { API_KEY: {} }, { API_KEY: null }]) {
          const response = await save({ [field]: value });
          assert.equal(response.status, 400);
          assert.equal((await response.json()).errorCode, "INVALID_CONFIG_PARAM_DOCUMENT");
          await assert.rejects(access(filePath), { code: "ENOENT" });
          assert.equal(rebuilds, 0);
        }
      }
      assert.equal((await save({ values: { API_KEY: "original" } })).status, 200);
      const original = await readFile(filePath, "utf8");
      const rebuildsBefore = rebuilds;
      assert.equal((await save({ values: false })).status, 400);
      assert.equal(await readFile(filePath, "utf8"), original);
      assert.equal(rebuilds, rebuildsBefore);
      const response = await save({ values: { API_KEY: "corrected" } });
      assert.equal(response.status, 200);
      assert.equal((await response.json()).values.API_KEY, "corrected");
      assert.equal(JSON.parse(await readFile(filePath, "utf8")).values.API_KEY, "corrected");
      const readResponse = await fetch(`${baseUrl}${endpoint}`);
      assert.equal(readResponse.status, 200);
      const readPayload = await readResponse.json();
      assert.equal(readPayload.scope, scope);
      assert.equal(readPayload.values.API_KEY, "corrected");
    });
  });
}
