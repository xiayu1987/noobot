/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import copyBackendAfterPack from "../../scripts/copy-backend-after-pack.mjs";

async function writeRuntimeFile(rootDir, relativePath, content = "test") {
  const filePath = path.join(rootDir, relativePath);
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, content);
}

async function createFixture() {
  const rootDir = await mkdtemp(path.join(os.tmpdir(), "noobot-copy-backend-after-pack-"));
  const projectDir = path.join(rootDir, "client", "windows");
  const backendSource = path.join(projectDir, "build", "backend-runtime", "backend");
  const appOutDir = path.join(projectDir, "dist", "win-unpacked");
  const frontendSource = path.join(rootDir, "client", "noobot-chat", "dist");

  await writeRuntimeFile(backendSource, "service/app.js");
  await writeRuntimeFile(backendSource, "node_modules/noobot-agent/package.json", "{}");
  await writeRuntimeFile(backendSource, "node_modules/express/package.json", "{}");
  await writeRuntimeFile(backendSource, "plugin/noobot-plugin-harness/manifest.json", "{}");
  await writeRuntimeFile(backendSource, "plugin/noobot-plugin-workflow/manifest.json", "{}");
  await writeRuntimeFile(backendSource, "service/config/global.config.example.json", "{}");
  await writeRuntimeFile(backendSource, "user-template/default-user/config.example.json", "{}");
  await writeRuntimeFile(frontendSource, "index.html", "<html></html>");

  const context = {
    appOutDir,
    electronPlatformName: "win32",
    packager: {
      projectDir,
    },
  };

  return { rootDir, context, backendSource, appOutDir };
}

test("copyBackendAfterPack copies backend plugins into packaged resources", async () => {
  const fixture = await createFixture();
  try {
    await copyBackendAfterPack(fixture.context);

    const backendDestination = path.join(fixture.appOutDir, "resources", "backend");
    assert.equal(
      await readFile(path.join(backendDestination, "plugin", "noobot-plugin-harness", "manifest.json"), "utf8"),
      "{}",
    );
    assert.equal(
      await readFile(path.join(backendDestination, "plugin", "noobot-plugin-workflow", "manifest.json"), "utf8"),
      "{}",
    );
  } finally {
    await rm(fixture.rootDir, { recursive: true, force: true });
  }
});

test("copyBackendAfterPack fails when prepared backend runtime is missing plugin manifests", async () => {
  const fixture = await createFixture();
  try {
    await rm(path.join(fixture.backendSource, "plugin", "noobot-plugin-harness"), { recursive: true, force: true });

    await assert.rejects(
      () => copyBackendAfterPack(fixture.context),
      /Missing required backend runtime file after prepare: plugin\/noobot-plugin-harness\/manifest\.json/,
    );
  } finally {
    await rm(fixture.rootDir, { recursive: true, force: true });
  }
});

test("copyBackendAfterPack fails when prepared backend runtime is missing default user template", async () => {
  const fixture = await createFixture();
  try {
    await rm(path.join(fixture.backendSource, "user-template"), { recursive: true, force: true });

    await assert.rejects(
      () => copyBackendAfterPack(fixture.context),
      /Missing required backend runtime file after prepare: user-template\/default-user\/config\.example\.json/,
    );
  } finally {
    await rm(fixture.rootDir, { recursive: true, force: true });
  }
});
