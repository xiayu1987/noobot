/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import test from "node:test";
import assert from "node:assert/strict";
import {
  createSessionPluginRuntimeBundle,
  getDefaultPluginDiagnostics,
} from "../../../src/extensions/plugins/session-plugin-runtime-provider.js";

test("agent host loads Manifest V2 plugins from the authoritative runtime", async () => {
  const bundle = await createSessionPluginRuntimeBundle();
  assert.deepEqual([...bundle.loadedPlugins.registry.keys()].sort(), [
    "character",
    "harness",
    "workflow",
  ]);
  assert.deepEqual(bundle.pluginRuntime.pluginIds.slice().sort(), [
    "character",
    "harness",
    "workflow",
  ]);
  assert.equal(bundle.pluginRuntime.surface, "agent");
});

test("agent plugin diagnostics expose protocol and surface", () => {
  const diagnostics = getDefaultPluginDiagnostics();
  assert.equal(diagnostics.protocolVersion, 2);
  assert.equal(diagnostics.surface, "agent");
  assert.equal(diagnostics.errors.length, 0);
});
