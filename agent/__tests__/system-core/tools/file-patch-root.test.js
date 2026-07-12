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

import { resolvePatchTargetsWithOptions } from "../../../src/system-core/tools/execution/file-patch.js";
import { classifyToolInputPath, TOOL_PATH_VIEWS } from "../../../src/system-core/utils/path-resolver.js";
import { ERROR_CODE } from "../../../src/system-core/error/constants.js";

// Dedicated coverage for the `root` parameter of patch resolution
// (resolvePatchTargetsWithOptions -> resolvePatchRoot). Pins the three
// documented writes: empty root (workspace default), workspace-relative child
// directory (allowed), and out-of-scope roots (absolute / sandbox-absolute /
// virtual-relative / parent traversal) which must be rejected so the diff
// header stays the single legal entry for absolute paths.

function buildAgentContext(basePath = "", userId = "u-test", overrides = {}) {
  const runtimeOverrides =
    overrides?.runtime && typeof overrides.runtime === "object" ? overrides.runtime : {};
  return {
    environment: {
      workspace: { basePath },
      identity: { userId },
    },
    execution: {
      controllers: {
        runtime: {
          basePath,
          userId,
          globalConfig: {},
          userConfig: {},
          systemRuntime: {
            userId,
            sessionId: "s-1",
            rootSessionId: "s-1",
            config: {},
          },
          ...runtimeOverrides,
        },
      },
    },
  };
}

async function mkWorkspace(prefix) {
  const basePath = await fs.mkdtemp(path.join(os.tmpdir(), prefix));
  return basePath;
}

function modifyPatch(target) {
  return [{ oldPath: target, newPath: target, mode: "modify" }];
}

test("resolvePatchRoot: 空 root 落在工作区默认根", async () => {
  const basePath = await mkWorkspace("noobot-patch-root-empty-");
  try {
    await fs.writeFile(path.join(basePath, "a.txt"), "one\ntwo\n", "utf8");
    const agentContext = buildAgentContext(basePath);
    const resolved = await resolvePatchTargetsWithOptions({
      patches: modifyPatch("a.txt"),
      agentContext,
      root: "",
    });
    assert.equal(resolved.length, 1);
    assert.equal(resolved[0].resolvedOldPath, path.join(basePath, "a.txt"));
    assert.equal(resolved[0].resolvedNewPath, path.join(basePath, "a.txt"));
  } finally {
    await fs.rm(basePath, { recursive: true, force: true });
  }
});

test("resolvePatchRoot: 工作区相对子目录 root 生效", async () => {
  const basePath = await mkWorkspace("noobot-patch-root-child-");
  try {
    await fs.mkdir(path.join(basePath, "sub"), { recursive: true });
    await fs.writeFile(path.join(basePath, "sub", "b.txt"), "one\ntwo\n", "utf8");
    const agentContext = buildAgentContext(basePath);
    const resolved = await resolvePatchTargetsWithOptions({
      patches: modifyPatch("b.txt"),
      agentContext,
      root: "sub",
    });
    assert.equal(resolved.length, 1);
    assert.equal(resolved[0].resolvedOldPath, path.join(basePath, "sub", "b.txt"));
    assert.equal(resolved[0].resolvedNewPath, path.join(basePath, "sub", "b.txt"));
  } finally {
    await fs.rm(basePath, { recursive: true, force: true });
  }
});

test("resolvePatchRoot: 非工作区相对子目录 root 一律拒绝", async () => {
  const basePath = await mkWorkspace("noobot-patch-root-reject-");
  try {
    await fs.writeFile(path.join(basePath, "a.txt"), "one\ntwo\n", "utf8");
    const agentContext = buildAgentContext(basePath);

    // Precondition: classifier splits these into the views resolvePatchRoot rejects.
    assert.equal(classifyToolInputPath("/etc", { agentContext }).view, TOOL_PATH_VIEWS.HOST_ABSOLUTE);
    assert.equal(classifyToolInputPath("/project", { agentContext }).view, TOOL_PATH_VIEWS.SANDBOX_ABSOLUTE);
    assert.equal(classifyToolInputPath("project", { agentContext }).view, TOOL_PATH_VIEWS.VIRTUAL_RELATIVE);

    const invalidRoots = ["..", "../escape", "/etc", "/project", "project", "project/agent"];
    for (const root of invalidRoots) {
      await assert.rejects(
        () =>
          resolvePatchTargetsWithOptions({
            patches: modifyPatch("a.txt"),
            agentContext,
            root,
          }),
        (error) => {
          assert.equal(error.code, ERROR_CODE.RECOVERABLE_PATH_OUT_OF_SCOPE, `root=${root} code`);
          assert.match(error.message, /patch root must be a workspace-relative child directory/, `root=${root} msg`);
          return true;
        },
        `root=${root} should be rejected`,
      );
    }
  } finally {
    await fs.rm(basePath, { recursive: true, force: true });
  }
});
