import test from "node:test";
import assert from "node:assert/strict";
import express from "express";
import os from "node:os";
import path from "node:path";
import { mkdtemp, rm } from "node:fs/promises";
import { registerFileCrudRoutes } from "../../routes/file-crud-routes.js";

async function withTestServer(app, run) {
  const server = await new Promise((resolve) => {
    const started = app.listen(0, () => resolve(started));
  });
  const { port } = server.address();
  const baseUrl = `http://127.0.0.1:${port}`;
  try {
    await run(baseUrl);
  } finally {
    await new Promise((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
  }
}

test("file-crud-routes: 缺少 path 时返回 400 + 标准错误体", async () => {
  const app = express();
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "noobot-file-crud-test-"));
  registerFileCrudRoutes(app, {
    routePrefix: "/internal/admin/workspace-all",
    resolveRootPath: () => tempRoot,
    buildWorkspaceTree: async () => ({ name: "root", children: [] }),
    translateText: (key) => (key === "common.pathRequired" ? "path-required" : key),
  });

  try {
    await withTestServer(app, async (baseUrl) => {
      const response = await fetch(`${baseUrl}/internal/admin/workspace-all/file`);
      const payload = await response.json();
      assert.equal(response.status, 400);
      assert.equal(payload.ok, false);
      assert.equal(payload.error, "path-required");
    });
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test("file-crud-routes: 支持基于 req 的根目录解析与自定义 tree 响应", async () => {
  const app = express();
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "noobot-file-crud-user-test-"));
  registerFileCrudRoutes(app, {
    routePrefix: "/internal/workspace/:userId",
    resolveRootPath: async (req) =>
      path.join(tempRoot, String(req?.params?.userId || "").trim()),
    buildWorkspaceTree: async () => ({ name: "user-root", children: [] }),
    translateText: (key) => key,
    responseBuilders: {
      tree: ({ req, root, tree }) => ({
        ok: true,
        userId: String(req?.params?.userId || "").trim(),
        root,
        tree,
      }),
    },
  });

  try {
    await withTestServer(app, async (baseUrl) => {
      const response = await fetch(`${baseUrl}/internal/workspace/alice/tree`);
      const payload = await response.json();
      assert.equal(response.status, 200);
      assert.equal(payload.ok, true);
      assert.equal(payload.userId, "alice");
      assert.equal(typeof payload.root, "string");
      assert.equal(payload.tree?.name, "user-root");
      assert.equal(payload.root.endsWith(path.join("alice")), true);
    });
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
});
