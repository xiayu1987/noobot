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
  TOOL_PATH_RESOLUTION_ERROR,
  classifyToolInputPath,
  convertPathView,
  detectPathPlatform,
  normalizePathForPlatform,
  isPathWithinRoot,
  PLATFORM_PROTECTED_ROOTS,
  resolvePathUnderRoot,
  TASK_PATH_KINDS,
  TASK_PATH_VIEW,
  createTaskPath,
  isTaskPath,
  normalizeTaskPathRelative,
  parseTaskPath,
  projectTaskPathText,
  resolveTaskPath,
  assertToolPathContract,
  authorizePathRef,
  BUILTIN_PATH_POLICY,
  resolvePathPolicy,
  resolvePathRef,
  resolveToolInputPath,
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

test("path containment distinguishes parent traversal from dot-prefixed names", () => {
  assert.equal(isPathWithinRoot("/srv/workspace", "/srv/workspace"), true);
  assert.equal(isPathWithinRoot("/srv/workspace", "/srv/workspace/..reports/a.txt"), true);
  assert.equal(isPathWithinRoot("/srv/workspace", "/srv/outside.txt"), false);
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

test("rejects workspace-relative traversal before it can be reclassified as a host path", () => {
  const escaped = resolveToolInputPath({
    inputPath: "../outside.txt",
    workspacePath: "/srv/workspaces/alice",
  });
  assert.equal(escaped.ok, false);
  assert.equal(escaped.view, TOOL_PATH_VIEWS.WORKSPACE_RELATIVE);
  assert.equal(escaped.error, TOOL_PATH_RESOLUTION_ERROR.WORKSPACE_PATH_OUT_OF_SCOPE);
  assert.equal(escaped.resolvedPath, "");

  const normalizedInside = resolveToolInputPath({
    inputPath: "reports/drafts/../final.txt",
    workspacePath: "/srv/workspaces/alice",
  });
  assert.equal(normalizedInside.ok, true);
  assert.equal(normalizedInside.resolvedPath, "/srv/workspaces/alice/reports/final.txt");

  const dotPrefixedInside = resolveToolInputPath({
    inputPath: "..reports/final.txt",
    workspacePath: "/srv/workspaces/alice",
  });
  assert.equal(dotPrefixedInside.ok, true);
  assert.equal(dotPrefixedInside.resolvedPath, "/srv/workspaces/alice/..reports/final.txt");
});

test("sandbox mode treats unmapped absolute paths as execution paths, never host refs", () => {
  const runtime = {
    basePath: "/srv/workspaces/alice",
    userId: "alice",
    globalConfig: {
      security: {
        executionIsolation: {
          mode: "sandbox",
          sandbox: { provider: "docker", scope: "user" },
        },
      },
    },
  };
  const result = resolveToolInputPath({
    inputPath: "/tmp/container-private.txt",
    runtime,
    workspacePath: runtime.basePath,
    workspaceRoot: "/srv/workspaces",
    allowHostAbsolute: true,
    allowSandbox: true,
  });
  assert.equal(result.ok, false);
  assert.equal(result.view, TOOL_PATH_VIEWS.SANDBOX_ABSOLUTE);
  assert.equal(result.error, TOOL_PATH_RESOLUTION_ERROR.SANDBOX_PATH_NOT_MAPPED);
  assert.equal(result.resolvedPath, "");
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
    /safe relative path without parent traversal/,
  );
  assert.throws(
    () => createTaskPath({ kind: TASK_PATH_KINDS.OUTPUT, relative: "/absolute.txt" }),
    /safe relative path without parent traversal/,
  );
  assert.throws(
    () => createTaskPath({ kind: TASK_PATH_KINDS.OUTPUT, relative: "C:\\absolute.txt" }),
    /safe relative path without parent traversal/,
  );
  assert.equal(normalizeTaskPathRelative("nested/./path//result.txt"), "nested/path/result.txt");
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

test("logical path contracts keep sandbox as execution view only", () => {
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
        display: "runtime",
      }),
    /script\.input/,
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

test("built-in path policy is complete and aligned with every tool contract", () => {
  assert.equal(Object.isFrozen(BUILTIN_PATH_POLICY), true);
  assert.equal(Object.isFrozen(BUILTIN_PATH_POLICY.roles.superAdmin.host.deniedRoots), true);
  assert.deepEqual(resolvePathPolicy({}, { platform: "windows" }), BUILTIN_PATH_POLICY);
  assert.deepEqual(PLATFORM_PROTECTED_ROOTS.linux, ["/proc", "/sys", "/dev"]);
  assert.deepEqual(BUILTIN_PATH_POLICY.display, {
    fileTools: "logical",
    scriptTools: "logical",
    nativeScript: "task-local",
    attachments: "identity",
    errors: "logical",
    audit: "execution",
  });
  for (const contract of Object.values(TOOL_PATH_CONTRACTS)) {
    assert.deepEqual(
      BUILTIN_PATH_POLICY.capabilities[contract.capability].acceptedViews,
      contract.accepted,
    );
  }
});

test("built-in protected roots follow the service execution platform", () => {
  assert.deepEqual(resolvePathPolicy({}, { platform: "linux" }).roles.superAdmin.host.deniedRoots, [
    "/proc",
    "/sys",
    "/dev",
  ]);
  assert.deepEqual(
    resolvePathPolicy({}, { platform: "win32" }).roles.superAdmin.host.deniedRoots,
    [],
  );
  assert.deepEqual(
    resolvePathPolicy({}, { platform: "darwin" }).roles.superAdmin.host.deniedRoots,
    ["/dev"],
  );
  assert.deepEqual(
    resolvePathPolicy(
      {
        security: {
          pathPolicy: {
            roles: { superAdmin: { host: { deniedRoots: ["C:/Windows/System32"] } } },
          },
        },
      },
      { platform: "windows" },
    ).roles.superAdmin.host.deniedRoots,
    ["C:/Windows/System32"],
  );
});

test("global path policy recursively overrides only configured values", () => {
  const policy = resolvePathPolicy(
    {
      security: {
        path_policy: {
          roles: {
            regular_user: { workspace: { others: "read_only" } },
            super_admin: { host: { allowed_roots: ["/srv/shared"] } },
          },
          capabilities: {
            "file.read": { host_requires_role: "deny" },
          },
          display: { file_tools: "none" },
        },
      },
    },
    { platform: "linux" },
  );

  assert.equal(policy.roles.regularUser.workspace.own, "read_write");
  assert.equal(policy.roles.regularUser.workspace.others, "read_only");
  assert.deepEqual(policy.roles.superAdmin.host.allowedRoots, ["/srv/shared"]);
  assert.deepEqual(policy.roles.superAdmin.host.deniedRoots, ["/proc", "/sys", "/dev"]);
  assert.deepEqual(policy.capabilities["file.read"].acceptedViews, ["workspace", "host"]);
  assert.equal(policy.capabilities["file.read"].hostRequiresRole, "deny");
  assert.equal(policy.capabilities["file.write"].hostRequiresRole, "super_admin");
  assert.equal(policy.display.fileTools, "none");
  assert.equal(policy.display.scriptTools, "logical");
  assert.equal(Object.hasOwn(policy.capabilities["file.read"], "host_requires_role"), false);
  assert.equal(Object.hasOwn(policy.roles.superAdmin.host, "allowed_roots"), false);
});

test("path authorization defaults to the built-in policy when callers omit it", () => {
  const result = authorizePathRef({
    pathRef: resolvePathRef({
      input: { view: "workspace", path: "report.txt", owner: "other" },
    }),
    principal: { userId: "u1", role: "regular_user" },
    capability: "file.read",
  });
  assert.equal(result.allowed, false);
  assert.equal(result.code, "workspace_owner_not_authorized");
});

test("global path policy expands host access only for super administrators", () => {
  const pathPolicy = resolvePathPolicy({}, { platform: "linux" });
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
      pathRef: resolvePathRef({ input: { view: "workspace", path: "../outside.txt" } }),
      principal: { userId: "admin", role: "super_admin" },
      capability: "file.read",
      pathPolicy,
      workspaceRoot: "/srv/workspaces/admin",
      executionPath: "/srv/workspaces/outside.txt",
    }).code,
    "workspace_path_out_of_scope",
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
