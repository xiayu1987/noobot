/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import test from "node:test";
import { clientFilePath as path } from "../../path-resolver.js";
import {
  buildDesktopBuilderEnv,
  resolveDesktopBuildProxy,
} from "../../scripts/run-electron-builder.js";

test("desktop builder prefers standard proxy environment", async () => {
  const proxy = await resolveDesktopBuildProxy({
    env: {
      HTTPS_PROXY: "http://127.0.0.1:7890",
      NOOBOT_DEPENDENCY_PROXY_URL: "http://127.0.0.1:7891",
    },
  });

  assert.equal(proxy.source, "environment:HTTPS_PROXY");
  assert.equal(proxy.proxyUrl, "http://127.0.0.1:7890");
  assert.equal(proxy.inherited, true);
});

test("desktop builder preserves standard proxy syntax for electron-builder", async () => {
  const proxy = await resolveDesktopBuildProxy({ env: { HTTPS_PROXY: "http://proxy.local" } });

  assert.equal(proxy.proxyUrl, "http://proxy.local");
  assert.equal(proxy.inherited, true);
});

test("desktop builder maps configured dependency proxy to download environment", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "noobot-desktop-build-"));
  try {
    const configDir = path.join(root, "service", "config");
    await mkdir(configDir, { recursive: true });
    await writeFile(
      path.join(configDir, "global.config.json"),
      JSON.stringify({ desktop: { dependency_proxy_url: "http://user:secret@127.0.0.1:7890" } }),
    );

    const proxy = await resolveDesktopBuildProxy({ env: {}, root });
    const environment = buildDesktopBuilderEnv({ env: { KEEP: "yes" }, proxy });
    assert.match(proxy.source, /^config:/);
    assert.equal(environment.KEEP, "yes");
    assert.equal(environment.HTTPS_PROXY, "http://user:secret@127.0.0.1:7890/");
    assert.equal(environment.HTTP_PROXY, environment.HTTPS_PROXY);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
