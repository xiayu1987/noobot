/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import assert from "node:assert/strict";
import test from "node:test";

import {
  PATH_PLATFORMS,
  PATH_VIEWS,
  TOOL_PATH_VIEWS,
  classifyToolInputPath,
  convertPathView,
  detectPathPlatform,
  normalizePathForPlatform,
  resolvePathUnderRoot,
  TASK_PATH_KINDS,
  TASK_PATH_VIEW,
  createTaskPath,
  isTaskPath,
  parseTaskPath,
  projectTaskPathText,
  resolveTaskPath,
  assertToolPathContract,
  authorizePathRef,
  resolvePathPolicy,
  resolvePathRef,
  TOOL_PATH_CONTRACTS,
} from "../src/index.mjs";

test("normalizes cross-platform path syntax through the protocol", () => {
  assert.equal(detectPathPlatform("C:\\work\\file.txt"), PATH_PLATFORMS.WINDOWS);
  assert.equal(normalizePathForPlatform("C:\\work\\..\\src\\file.txt"), "C:/src/file.txt");
  assert.equal(resolvePathUnderRoot("/workspace/app", "src/file.js"), "/workspace/app/src/file.js");
  assert.equal(
    resolvePathUnderRoot("/workspace/app", "C:\\work\\src\\file.js"),
    "C:/work/src/file.js",
  );
});

test("converts explicit path views without losing the source contract", () => {
  const result = convertPathView({
    path: "C:\\Users\\me\\project\\file.txt",
    sourcePlatform: PATH_PLATFORMS.WINDOWS,
    sourceView: PATH_VIEWS.CLIENT,
    targetPlatform: PATH_PLATFORMS.LINUX,
    targetView: PATH_VIEWS.SANDBOX,
    mappings: [
      { client: "C:/Users/me/project", host: "/srv/project", sandbox: "/workspace/project" },
    ],
  });
  assert.equal(result.path, "/workspace/project/file.txt");
  assert.equal(result.sourceView, PATH_VIEWS.CLIENT);
  assert.equal(result.targetView, PATH_VIEWS.SANDBOX);
});

test("classifies tool input views as one canonical result", () => {
  assert.equal(classifyToolInputPath("src/file.js").view, TOOL_PATH_VIEWS.WORKSPACE_RELATIVE);
  assert.equal(classifyToolInputPath("/project/file.js").view, TOOL_PATH_VIEWS.SANDBOX_ABSOLUTE);
  assert.equal(classifyToolInputPath("C:\\work\\file.js").view, TOOL_PATH_VIEWS.HOST_ABSOLUTE);
});

test("task-local paths have one token and resolution protocol", () => {
  assert.equal(TASK_PATH_VIEW, "task-local");
  const output = createTaskPath({ kind: TASK_PATH_KINDS.OUTPUT, relative: "media/result.mp4" });
  assert.equal(output, "output://media/result.mp4");
  assert.equal(isTaskPath(output, { kind: TASK_PATH_KINDS.OUTPUT }), true);
  assert.deepEqual(parseTaskPath(output), {
    token: output,
    kind: TASK_PATH_KINDS.OUTPUT,
    relative: "media/result.mp4",
  });
  assert.equal(
    resolveTaskPath({ token: output, roots: { output: "/runtime/output" } }).path,
    "/runtime/output/media/result.mp4",
  );
  assert.equal(createTaskPath({ kind: TASK_PATH_KINDS.OUTPUT, allowRoot: true }), "output://");
  assert.throws(
    () => createTaskPath({ kind: TASK_PATH_KINDS.TEMP, relative: "../escape" }),
    /invalid/,
  );
});

test("task-local projection replaces only declared runtime roots", () => {
  assert.equal(
    projectTaskPathText("/runtime/input/0.txt /runtime/input-old/1.txt /home/user/data.txt", [
      { hostRoot: "/runtime/input", taskRoot: "input://" },
    ]),
    "input://0.txt /runtime/input-old/1.txt /home/user/data.txt",
  );
  assert.throws(
    () => projectTaskPathText("value", [{ hostRoot: "/runtime/input", taskRoot: "input://0" }]),
    /task root/,
  );
});

test("logical path contracts keep sandbox exclusive to script execution", () => {
  for (const contract of Object.values(TOOL_PATH_CONTRACTS))
    assert.doesNotThrow(() => assertToolPathContract(contract));
  assert.throws(
    () =>
      assertToolPathContract({
        capability: "file.read",
        accepted: ["sandbox"],
        execution: ["host"],
        display: "logical",
      }),
    /sandbox/,
  );
  assert.throws(
    () =>
      assertToolPathContract({
        capability: "file.read",
        accepted: ["workspace"],
        execution: ["sandbox"],
        display: "logical",
      }),
    /script.input/,
  );
  assert.throws(
    () => resolvePathRef({ input: { view: "sandbox", path: "/workspace/a.txt" } }),
    /invalid logical path view/,
  );
  const taskLocal = resolvePathRef({ input: { view: "task-local", path: "output://a.txt" } });
  assert.equal(
    authorizePathRef({
      pathRef: taskLocal,
      principal: { role: "super_admin" },
      capability: "file.read",
      pathPolicy: resolvePathPolicy({}),
    }).allowed,
    false,
  );
});

test("global path policy expands host access only for super administrators", () => {
  const pathPolicy = resolvePathPolicy({});
  const hostRef = resolvePathRef({
    input: "/data/report.txt",
    workspaceRoot: "/srv/workspaces/u1",
  });
  assert.equal(
    authorizePathRef({
      pathRef: hostRef,
      principal: { role: "regular_user" },
      capability: "file.read",
      pathPolicy,
      executionPath: "/data/report.txt",
    }).allowed,
    false,
  );
  assert.equal(
    authorizePathRef({
      pathRef: hostRef,
      principal: { role: "super_admin" },
      capability: "file.read",
      pathPolicy,
      executionPath: "/data/report.txt",
    }).allowed,
    true,
  );
  assert.equal(
    authorizePathRef({
      pathRef: resolvePathRef({ input: "/proc/1/status" }),
      principal: { role: "super_admin" },
      capability: "file.read",
      pathPolicy,
      executionPath: "/proc/1/status",
    }).allowed,
    false,
  );
  const customPolicy = resolvePathPolicy({
    security: {
      pathPolicy: {
        roles: {
          superAdmin: {
            host: {
              access: "allow",
              allowedRoots: ["<host-filesystem>"],
              deniedRoots: ["/private"],
            },
          },
        },
      },
    },
  });
  assert.equal(
    authorizePathRef({
      pathRef: resolvePathRef({ input: "/private/report.txt" }),
      principal: { role: "super_admin" },
      capability: "file.read",
      pathPolicy: customPolicy,
      executionPath: "/private/report.txt",
    }).code,
    "host_path_denied",
  );
  const otherWorkspaceRef = resolvePathRef({
    input: { view: "workspace", path: "report.txt", owner: "other" },
  });
  assert.equal(
    authorizePathRef({
      pathRef: otherWorkspaceRef,
      principal: { userId: "u1", role: "regular_user" },
      capability: "file.read",
      pathPolicy,
    }).allowed,
    false,
  );
  assert.equal(
    authorizePathRef({
      pathRef: otherWorkspaceRef,
      principal: { userId: "admin", role: "super_admin" },
      capability: "file.read",
      pathPolicy,
    }).allowed,
    true,
  );
});
