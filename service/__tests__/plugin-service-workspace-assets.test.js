/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { Readable } from "node:stream";
import { createPluginServicePorts } from "../services/plugin-service-ports.js";

test("workspace asset port writes immutable content and reads the exact version", async (t) => {
  const workspace = await fs.mkdtemp(path.join(os.tmpdir(), "noobot-plugin-asset-"));
  t.after(() => fs.rm(workspace, { recursive: true, force: true }));
  const port = createPluginServicePorts({
    bot: { getWorkspacePath: () => workspace },
  }).workspaceAssets.forPlugin("character");
  const content = Buffer.from("immutable-glb-content");

  const written = await port.write({
    userId: "admin",
    assetId: "asset.one",
    source: Readable.from(content),
    declaredBytes: content.length,
  });
  const read = await port.read({
    userId: "admin",
    assetId: written.assetId,
    version: written.version,
  });
  const chunks = [];
  for await (const chunk of read.stream) chunks.push(chunk);

  assert.equal(written.version, "69e50561ce37034d604bbfcc45d9e18e4f34119d6779bad42d0a0869f7ce270e");
  assert.deepEqual(Buffer.concat(chunks), content);
  assert.equal(
    await port.read({ userId: "admin", assetId: "asset.one", version: "a".repeat(64) }),
    null,
  );
});

test("workspace asset port rejects invalid identity before filesystem access", async () => {
  const port = createPluginServicePorts({
    bot: { getWorkspacePath: () => "/tmp/unreachable" },
  }).workspaceAssets.forPlugin("character");
  await assert.rejects(
    () =>
      port.write({
        userId: "admin",
        assetId: "../escape",
        source: Readable.from("x"),
        declaredBytes: 1,
      }),
    /invalid workspace asset ID/,
  );
});
