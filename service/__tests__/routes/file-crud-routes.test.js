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
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { registerFileCrudRoutes } from "../../routes/file-crud-routes.js";
import { buildWorkspaceTree } from "../../services/workspace-tree-service.js";

async function withTestServer(app, run) {
  const server = await new Promise((resolve) => {
    const started = app.listen(0, "127.0.0.1", () => resolve(started));
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
    resolveRootPath: async (req) => path.join(tempRoot, String(req?.params?.userId || "").trim()),
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

test("file-crud-routes: 默认拒绝读取 root 外绝对路径", async () => {
  const app = express();
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "noobot-file-crud-root-"));
  const outsideRoot = await mkdtemp(path.join(os.tmpdir(), "noobot-file-crud-outside-"));
  const outsideFile = path.join(outsideRoot, "outside.txt");
  await writeFile(outsideFile, "outside", "utf8");
  registerFileCrudRoutes(app, {
    routePrefix: "/internal/admin/workspace-all",
    resolveRootPath: () => tempRoot,
    buildWorkspaceTree: async () => ({ name: "root", children: [] }),
    translateText: (key) => key,
  });

  try {
    await withTestServer(app, async (baseUrl) => {
      const response = await fetch(
        `${baseUrl}/internal/admin/workspace-all/file?path=${encodeURIComponent(outsideFile)}`,
      );
      const payload = await response.json();
      assert.equal(response.status, 400);
      assert.equal(payload.ok, false);
    });
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
    await rm(outsideRoot, { recursive: true, force: true });
  }
});

test("file-crud-routes: allowAbsolutePath=true 时允许读取和写入 root 外绝对路径", async () => {
  const app = express();
  app.use(express.json());
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "noobot-file-crud-root-"));
  const outsideRoot = await mkdtemp(path.join(os.tmpdir(), "noobot-file-crud-outside-"));
  const outsideFile = path.join(outsideRoot, "nested", "outside.txt");
  await mkdir(path.dirname(outsideFile), { recursive: true });
  await writeFile(outsideFile, "outside", "utf8");
  registerFileCrudRoutes(app, {
    routePrefix: "/internal/admin/workspace-all",
    resolveRootPath: () => tempRoot,
    buildWorkspaceTree: async () => ({ name: "root", children: [] }),
    translateText: (key) => key,
    allowAbsolutePath: true,
  });

  try {
    await withTestServer(app, async (baseUrl) => {
      const readResponse = await fetch(
        `${baseUrl}/internal/admin/workspace-all/file?path=${encodeURIComponent(outsideFile)}`,
      );
      const readPayload = await readResponse.json();
      assert.equal(readResponse.status, 200);
      assert.equal(readPayload.ok, true);
      assert.equal(readPayload.content, "outside");

      const writeResponse = await fetch(`${baseUrl}/internal/admin/workspace-all/file`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ path: outsideFile, content: "updated" }),
      });
      const writePayload = await writeResponse.json();
      assert.equal(writeResponse.status, 200);
      assert.equal(writePayload.ok, true);

      const rereadResponse = await fetch(
        `${baseUrl}/internal/admin/workspace-all/file?path=${encodeURIComponent(outsideFile)}`,
      );
      const rereadPayload = await rereadResponse.json();
      assert.equal(rereadPayload.content, "updated");
    });
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
    await rm(outsideRoot, { recursive: true, force: true });
  }
});

test("file-crud-routes: 拒绝写入非法 JSON 配置且保留原文件", async () => {
  const app = express();
  app.use(express.json());
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "noobot-file-crud-json-guard-"));
  const configPath = path.join(tempRoot, "admin", "config.json");
  await mkdir(path.dirname(configPath), { recursive: true });
  await writeFile(configPath, '{"valid":true}\n', "utf8");
  registerFileCrudRoutes(app, {
    routePrefix: "/internal/workspace/:userId",
    resolveRootPath: (req) => path.join(tempRoot, String(req?.params?.userId || "").trim()),
    buildWorkspaceTree: async () => ({ name: "root", children: [] }),
    translateText: (key) => key,
  });

  try {
    await withTestServer(app, async (baseUrl) => {
      const response = await fetch(`${baseUrl}/internal/workspace/admin/file`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          path: "config.json",
          content: '{"first":1}{"second":2}',
        }),
      });
      const payload = await response.json();
      assert.equal(response.status, 400);
      assert.equal(payload.ok, false);
      assert.equal(payload.errorCode, "INVALID_JSON_DOCUMENT");
      assert.equal(await readFile(configPath, "utf8"), '{"valid":true}\n');
    });
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test("file-crud-routes: mutation file endpoint returns the persisted after snapshot", async () => {
  const app = express();
  app.use(express.json());
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "noobot-file-crud-mutation-file-"));
  registerFileCrudRoutes(app, {
    routePrefix: "/internal/workspace/:userId",
    resolveRootPath: () => tempRoot,
    buildWorkspaceTree: async () => ({ name: "root", children: [] }),
    translateText: (key) => key,
    trackMutations: true,
    readMutations: true,
    resolveMutationRoot: (req) => path.join(tempRoot, "runtime", "session", req.query.sessionId),
  });
  try {
    await withTestServer(app, async (baseUrl) => {
      const writeResponse = await fetch(`${baseUrl}/internal/workspace/admin/file?sessionId=s1`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ path: "history.txt", content: "historical-after\n" }),
      });
      const writePayload = await writeResponse.json();
      assert.equal(writeResponse.status, 200);
      const mutationId = writePayload.mutations[0].id;
      await writeFile(path.join(tempRoot, "history.txt"), "later-version\n", "utf8");

      const fileResponse = await fetch(
        `${baseUrl}/internal/workspace/admin/file-mutations/${encodeURIComponent(mutationId)}/file?sessionId=s1`,
      );
      const filePayload = await fileResponse.json();
      assert.equal(fileResponse.status, 200);
      assert.equal(filePayload.content, "historical-after\n");
      assert.equal(filePayload.mutationId, mutationId);
    });
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test("file-crud-routes: mutation read routes are absent when not enabled", async () => {
  const app = express();
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "noobot-file-crud-no-mutation-read-"));
  registerFileCrudRoutes(app, {
    routePrefix: "/internal/admin/workspace-all",
    resolveRootPath: () => tempRoot,
    buildWorkspaceTree: async () => ({ name: "root", children: [] }),
    translateText: (key) => key,
  });
  try {
    await withTestServer(app, async (baseUrl) => {
      const response = await fetch(
        `${baseUrl}/internal/admin/workspace-all/file-mutations/11111111-1111-4111-8111-111111111111/file`,
      );
      assert.equal(response.status, 404);
    });
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test("workspace tree excludes workspace mutation control directories", async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "noobot-workspace-tree-control-"));
  try {
    await mkdir(path.join(tempRoot, "admin.mutation-lock", "nested"), { recursive: true });
    await mkdir(path.join(tempRoot, "admin"), { recursive: true });
    assert.deepEqual(await buildWorkspaceTree(tempRoot), [
      {
        label: "admin",
        path: "admin",
        type: "dir",
        children: [],
      },
    ]);
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
});
