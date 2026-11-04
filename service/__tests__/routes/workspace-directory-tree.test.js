/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import test from "node:test";
import assert from "node:assert/strict";
import express from "express";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { registerFileCrudRoutes } from "../../routes/file-crud-routes.js";
import { buildWorkspaceTree } from "../../services/workspace-tree-service.js";

test("directory queries return direct children, preserve nested paths and reject invalid scope", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "noobot-directory-query-"));
  const app = express();
  await mkdir(path.join(root, "nested", "deeper"), { recursive: true });
  await writeFile(path.join(root, "nested", "中文.txt"), "fixture");
  await writeFile(path.join(root, ".hidden"), "hidden");
  registerFileCrudRoutes(app, {
    routePrefix: "/workspace",
    resolveRootPath: () => root,
    buildWorkspaceTree,
    translateText: (key) => key,
  });
  const server = app.listen(0, "127.0.0.1");
  await new Promise((resolve) => server.once("listening", resolve));
  const base = `http://127.0.0.1:${server.address().port}/workspace/tree`;
  try {
    assert.deepEqual((await (await fetch(base)).json()).tree, [
      { label: "nested", path: "nested", type: "dir" },
    ]);
    assert.deepEqual((await (await fetch(`${base}?path=nested`)).json()).tree, [
      { label: "deeper", path: "nested/deeper", type: "dir" },
      { label: "中文.txt", path: "nested/中文.txt", type: "file" },
    ]);
    assert.deepEqual((await (await fetch(`${base}?path=nested/deeper`)).json()).tree, []);
    for (const query of ["path=..", "path=a&path=b"]) {
      const response = await fetch(`${base}?${query}`);
      assert.equal(response.status, 400);
      assert.equal((await response.json()).ok, false);
    }
    const missing = await fetch(`${base}?path=missing`);
    assert.equal(missing.ok, false);
    assert.equal((await missing.json()).ok, false);
  } finally {
    await new Promise((resolve) => server.close(resolve));
    await rm(root, { recursive: true, force: true });
  }
});
