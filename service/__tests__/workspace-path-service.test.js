/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import { WORKSPACE_ROOT_ENV } from "@noobot/runtime-topology-protocol/workspace-root";
import { createWorkspacePathService } from "../services/workspace-path-service.js";

const serviceDir = path.resolve("/srv/noobot/service");
const workspaceRoot = path.resolve(serviceDir, "../workspace");

function createService(rawConfig) {
  return createWorkspacePathService({ serviceDir, getGlobalConfigRaw: () => rawConfig });
}

test("workspace paths resolve against the explicit serviceDir", () => {
  const service = createService({ workspaceRoot: "../workspace", workspaceTemplatePath: "tpl" });
  assert.equal(service.workspaceRootPath(), workspaceRoot);
  assert.equal(service.templateRootPath(), path.join(serviceDir, "tpl"));
});

test("serviceDir is required and must be absolute", () => {
  assert.throws(() => createWorkspacePathService({ getGlobalConfigRaw: () => ({}) }), TypeError);
  assert.throws(
    () => createWorkspacePathService({ serviceDir: "service", getGlobalConfigRaw: () => ({}) }),
    TypeError,
  );
});

test("assertWorkspaceRootMatchesEnv accepts the same root and rejects divergence", () => {
  const service = createService({ workspaceRoot: "../workspace" });
  assert.equal(
    service.assertWorkspaceRootMatchesEnv({ [WORKSPACE_ROOT_ENV]: workspaceRoot }),
    workspaceRoot,
  );
  assert.throws(
    () => service.assertWorkspaceRootMatchesEnv({ [WORKSPACE_ROOT_ENV]: "/other/workspace" }),
    /does not match global config workspace_root/,
  );
  assert.throws(() => service.assertWorkspaceRootMatchesEnv({}), /is required/);
});
