/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import test from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { clientFilePath as path } from "../../path-resolver.js";
import { resolveDesktopBackendRuntimeWorkspaces } from "../../scripts/backend-runtime-workspaces.js";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../..");

test("desktop backend runtime follows the complete production workspace dependency graph", async () => {
  const runtimeWorkspaces = await resolveDesktopBackendRuntimeWorkspaces({ repoRoot });

  for (const requiredWorkspace of [
    "event-protocol",
    "authoritative-state",
    "context-protocol",
    "connector-protocol",
    "agent-config-protocol",
    "platform-compatibility",
    "execution-isolation-protocol",
    "security-assessment-protocol",
    "service",
    "agent",
    "agent-proxy",
    "model-proxy",
    "plugin/noobot-plugin-harness",
    "plugin/noobot-plugin-workflow",
  ]) {
    assert.equal(runtimeWorkspaces.includes(requiredWorkspace), true, requiredWorkspace);
  }
  assert.equal(
    runtimeWorkspaces.some((workspace) => workspace.startsWith("client/")),
    false,
  );
});
