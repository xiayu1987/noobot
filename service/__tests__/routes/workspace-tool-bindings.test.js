/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import test from "node:test";
import assert from "node:assert/strict";
import express from "express";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { registerWorkspaceRoutes } from "../../routes/workspace-routes.js";
import { withTestServer } from "./session-routes.helpers.js";
import { mergeConfig } from "@noobot/agent-config-protocol";

test("workspace binding writes validate inherited and unchanged names before changing disk", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "workspace-tool-bindings-"));
  const userRoot = path.join(root, "alice");
  await mkdir(userRoot);
  const configPath = path.join(userRoot, "config.json");
  const initial = '{"tools":{}}\n';
  await writeFile(configPath, initial);
  const globalConfig = { tools: { bindings: { read_file: { bindingName: "read_document" } } } };
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.auth = { role: "super_admin" };
    next();
  });
  registerWorkspaceRoutes(app, {
    workspaceService: { ensureUserWorkspace: async () => userRoot },
    workspaceRootPath: () => root,
    requireApiKey: (_req, _res, next) => next(),
    requireSuperAdmin: (_req, _res, next) => next(),
    globalConfig,
    translateText: (key) => key,
  });
  try {
    await withTestServer(app, async (baseUrl) => {
      for (const [route, requestedPath] of [
        ["/internal/workspace/alice/file", "config.json"],
        ["/internal/admin/workspace-all/file", "alice/config.json"],
        ["/internal/admin/workspace-all/file", configPath],
      ]) {
        await writeFile(configPath, initial);
        const write = (bindings) =>
          fetch(`${baseUrl}${route}`, {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              path: requestedPath,
              content: JSON.stringify({ tools: { bindings } }),
            }),
          });
        for (const bindings of [
          { search: { bindingName: "read_document" } },
          { read_file: { bindingName: "search" } },
          { search: { bindingName: "invalid.name" } },
          { search: { bindingName: "" } },
        ]) {
          const response = await write(bindings);
          const result = await response.json();
          assert.equal(response.status, 400, JSON.stringify(result));
          assert.match(result.error, /duplicate|invalid/);
          assert.equal(await readFile(configPath, "utf8"), initial);
        }
        const overrides = { read_file: { bindingName: "read_text" } };
        assert.equal((await write(overrides)).status, 200);
        const saved = JSON.parse(await readFile(configPath, "utf8"));
        assert.deepEqual(saved.tools.bindings, overrides);
        assert.equal(
          mergeConfig(globalConfig, saved).tools.bindings.read_file.bindingName,
          "read_text",
        );
        assert.equal((await write({})).status, 200);
        const restored = JSON.parse(await readFile(configPath, "utf8"));
        assert.equal(
          mergeConfig(globalConfig, restored).tools.bindings.read_file.bindingName,
          "read_document",
        );
      }
    });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
