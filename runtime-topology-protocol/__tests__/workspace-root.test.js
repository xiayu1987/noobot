/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  DEFAULT_GLOBAL_CONFIG_RELATIVE_PATH,
  GLOBAL_CONFIG_PATH_ENV,
  WORKSPACE_ROOT_ENV,
  requireWorkspaceRootEnv,
  resolveConfiguredWorkspaceRoot,
  resolveGlobalConfigPath,
  resolveWorkspaceRootPath,
} from "../src/workspace-root.js";

const serviceDir = path.resolve("/srv/noobot/service");

test("resolveGlobalConfigPath prefers explicit path, then env, then the default", () => {
  assert.equal(
    resolveGlobalConfigPath({ serviceDir, filePath: "a.json", env: {} }),
    path.join(serviceDir, "a.json"),
  );
  assert.equal(
    resolveGlobalConfigPath({ serviceDir, env: { [GLOBAL_CONFIG_PATH_ENV]: "/etc/g.json" } }),
    "/etc/g.json",
  );
  assert.equal(
    resolveGlobalConfigPath({ serviceDir, env: {} }),
    path.join(serviceDir, DEFAULT_GLOBAL_CONFIG_RELATIVE_PATH),
  );
  assert.throws(() => resolveGlobalConfigPath({ serviceDir: "service", env: {} }), TypeError);
});

test("resolveWorkspaceRootPath resolves against serviceDir without a default", () => {
  assert.equal(
    resolveWorkspaceRootPath({ configuredRoot: "../workspace", serviceDir }),
    path.resolve(serviceDir, "../workspace"),
  );
  assert.equal(resolveWorkspaceRootPath({ configuredRoot: " /data/ws ", serviceDir }), "/data/ws");
  for (const configuredRoot of [undefined, "", "   ", 42]) {
    assert.throws(
      () => resolveWorkspaceRootPath({ configuredRoot, serviceDir }),
      /workspace_root is required/,
    );
  }
  assert.throws(
    () => resolveWorkspaceRootPath({ configuredRoot: "../workspace", serviceDir: "service" }),
    TypeError,
  );
});

test("resolveConfiguredWorkspaceRoot reads workspace_root from the config file", async (t) => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "nb-workspace-root-"));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  const withRoot = path.join(dir, "with-root.json");
  const withoutRoot = path.join(dir, "without-root.json");
  await fs.writeFile(withRoot, JSON.stringify({ workspace_root: "../workspace" }));
  await fs.writeFile(withoutRoot, JSON.stringify({}));

  assert.equal(
    resolveConfiguredWorkspaceRoot({ globalConfigPath: withRoot, serviceDir }),
    path.resolve(serviceDir, "../workspace"),
  );
  assert.throws(
    () => resolveConfiguredWorkspaceRoot({ globalConfigPath: withoutRoot, serviceDir }),
    /workspace_root is required/,
  );
  assert.throws(
    () => resolveConfiguredWorkspaceRoot({ globalConfigPath: "g.json", serviceDir }),
    TypeError,
  );
});

test("requireWorkspaceRootEnv only accepts an absolute injected root", () => {
  assert.equal(requireWorkspaceRootEnv({ [WORKSPACE_ROOT_ENV]: "/data/ws" }), "/data/ws");
  assert.throws(() => requireWorkspaceRootEnv({}), /is required/);
  assert.throws(
    () => requireWorkspaceRootEnv({ [WORKSPACE_ROOT_ENV]: "workspace" }),
    /must be an absolute path/,
  );
});
