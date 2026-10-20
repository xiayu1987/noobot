/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import test from "node:test";
import assert from "node:assert/strict";

import {
  PATH_PLATFORMS,
  TOOL_PATH_VIEWS,
  TOOL_PATH_RESOLUTION_ERROR,
  classifyToolInputPath,
  detectPathPlatform,
  isAbsolutePathAnyPlatform,
  isAbsolutePathForPlatform,
  joinPathForPlatform,
  normalizePathForPlatform,
  resolvePathPolicy,
  resolveRuntimeOpsWorkdir,
  resolveRuntimePathContext,
  resolveSuperAdminHostRoots,
  resolveToolInputPath,
} from "@noobot/path-resolver";
import { resolveToolExecutionPolicy } from "@noobot/execution-isolation-protocol";

function executeScriptPolicy(globalConfig = {}) {
  return resolveToolExecutionPolicy({ toolName: "execute_script", globalConfig });
}

test("detects foreign platform paths without using process.platform", () => {
  assert.equal(detectPathPlatform("C:\\Users\\张三\\file.txt"), PATH_PLATFORMS.WINDOWS);
  assert.equal(detectPathPlatform("\\\\server\\share\\file.txt"), PATH_PLATFORMS.WINDOWS);
  assert.equal(detectPathPlatform("/Users/test/file.txt", "macos"), PATH_PLATFORMS.MACOS);
  assert.equal(detectPathPlatform("/home/test/file.txt"), "");
  assert.equal(detectPathPlatform("/Users/test/file.txt"), "");
});

test("normalizes drive, UNC, file URL and dot segments", () => {
  assert.equal(
    normalizePathForPlatform("C:\\Users\\me\\..\\you\\文 件.txt"),
    "C:/Users/you/文 件.txt",
  );
  assert.equal(normalizePathForPlatform("\\\\server\\share\\a\\..\\b"), "//server/share/b");
  assert.equal(normalizePathForPlatform("file:///C:/Users/me/a%20b.txt"), "C:/Users/me/a b.txt");
  assert.equal(normalizePathForPlatform("/Users/me/a/../b", { platform: "macos" }), "/Users/me/b");
});

test("checks absoluteness according to the path platform", () => {
  assert.equal(isAbsolutePathForPlatform("C:\\Users\\me", "windows"), true);
  assert.equal(isAbsolutePathForPlatform("C:relative", "windows"), false);
  assert.equal(isAbsolutePathForPlatform("\\\\server\\share\\a", "windows"), true);
  assert.equal(isAbsolutePathForPlatform("/home/me", "linux"), true);
  assert.equal(isAbsolutePathForPlatform("home/me", "linux"), false);
  assert.equal(isAbsolutePathAnyPlatform("C:\\Users\\me"), true);
  assert.equal(isAbsolutePathAnyPlatform("\\\\server\\share\\a"), true);
  assert.equal(isAbsolutePathAnyPlatform("home/me"), false);
});

test("joins paths using the source path semantics", () => {
  assert.equal(joinPathForPlatform("C:\\Users\\me", "docs", "../file.txt"), "C:/Users/me/file.txt");
  assert.equal(joinPathForPlatform("/Users/me", "docs", "file.txt"), "/Users/me/docs/file.txt");
});

test("classifies tool input path views explicitly", () => {
  assert.equal(classifyToolInputPath("i18n/src/a.js").view, TOOL_PATH_VIEWS.WORKSPACE_RELATIVE);
  assert.equal(classifyToolInputPath("/workspace/u1/a.js").view, TOOL_PATH_VIEWS.SANDBOX_ABSOLUTE);
  assert.equal(classifyToolInputPath("/project/a.js").view, TOOL_PATH_VIEWS.SANDBOX_ABSOLUTE);
  assert.equal(classifyToolInputPath("project/a.js").view, TOOL_PATH_VIEWS.VIRTUAL_RELATIVE);
  assert.equal(classifyToolInputPath("C:\\work\\a.js").view, TOOL_PATH_VIEWS.HOST_ABSOLUTE);
});

test("ordinary tool paths reject sandbox and ambiguous virtual views", () => {
  const runtime = {
    basePath: "/workspace-root/u1",
    systemRuntime: { userId: "u1" },
    globalConfig: {
      tools: {
        execute_script: {
          execution: { view: "sandbox" },
        },
      },
    },
  };
  const agentContext = { environment: { workspace: { basePath: "/workspace-root/u1" } } };

  const workspaceRelative = resolveToolInputPath({
    inputPath: "src/a.js",
    runtime,
    agentContext,
    workspacePath: "/workspace-root/u1",
  });
  assert.equal(workspaceRelative.ok, true);
  assert.equal(workspaceRelative.view, TOOL_PATH_VIEWS.WORKSPACE_RELATIVE);
  assert.equal(workspaceRelative.resolvedPath, "/workspace-root/u1/src/a.js");

  const sandboxAbsolute = resolveToolInputPath({
    inputPath: "/workspace/u1/src/a.js",
    runtime,
    agentContext,
    workspacePath: "/workspace-root/u1",
  });
  assert.equal(sandboxAbsolute.ok, false);
  assert.equal(sandboxAbsolute.view, TOOL_PATH_VIEWS.SANDBOX_ABSOLUTE);
  assert.equal(sandboxAbsolute.error, "sandbox_path_not_allowed");

  const dockerUserSandboxAbsolute = resolveToolInputPath({
    inputPath: "/workspace/src/a.js",
    runtime: {
      ...runtime,
      globalConfig: {
        security: {
          executionIsolation: {
            mode: "sandbox",
            sandbox: { provider: "docker", scope: "user" },
          },
        },
      },
    },
    agentContext,
    workspacePath: "/workspace-root/u1",
  });
  assert.equal(dockerUserSandboxAbsolute.ok, false);
  assert.equal(dockerUserSandboxAbsolute.error, "sandbox_path_not_allowed");

  const virtualRelative = resolveToolInputPath({
    inputPath: "project/src/a.js",
    runtime,
    agentContext,
    workspacePath: "/workspace-root/u1",
    allowVirtualRelative: false,
  });
  assert.equal(virtualRelative.ok, false);
  assert.equal(virtualRelative.error, "virtual_relative_path_ambiguous");
  assert.equal(virtualRelative.candidateWorkspaceRelativePath, "src/a.js");
  assert.equal(virtualRelative.candidateSandboxPath, "");
  assert.equal(Object.hasOwn(virtualRelative, "hint"), false);

  const hostAbsolute = resolveToolInputPath({
    inputPath: "C:\\outside\\a.js",
    runtime,
    agentContext: {
      environment: { os: { platform: "win32" }, workspace: { basePath: "/workspace-root/u1" } },
    },
    workspacePath: "/workspace-root/u1",
    allowHostAbsolute: true,
  });
  assert.equal(hostAbsolute.ok, true);
  assert.equal(hostAbsolute.view, TOOL_PATH_VIEWS.HOST_ABSOLUTE);
  assert.equal(hostAbsolute.resolvedPath, "C:/outside/a.js");
});

test("workspace-relative traversal retains its logical view when rejected", () => {
  const result = resolveToolInputPath({
    inputPath: "../outside.txt",
    workspacePath: "/workspace-root/u1",
  });
  assert.equal(result.ok, false);
  assert.equal(result.view, TOOL_PATH_VIEWS.WORKSPACE_RELATIVE);
  assert.equal(result.error, TOOL_PATH_RESOLUTION_ERROR.WORKSPACE_PATH_OUT_OF_SCOPE);
});

test("sandbox mode does not reinterpret an unmapped absolute path as host", () => {
  const runtime = {
    basePath: "/workspace-root/u1",
    systemRuntime: { userId: "u1" },
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
    inputPath: "/etc/hosts",
    runtime,
    workspacePath: runtime.basePath,
    allowHostAbsolute: true,
    allowSandbox: true,
  });
  assert.equal(result.ok, false);
  assert.equal(result.view, TOOL_PATH_VIEWS.SANDBOX_ABSOLUTE);
  assert.equal(result.error, TOOL_PATH_RESOLUTION_ERROR.SANDBOX_PATH_NOT_MAPPED);
});

function pathContextInput(overrides = {}) {
  const globalConfig = overrides.globalConfig || {};
  return {
    hostRootDirectory: "/host/workspaces/u1",
    userId: "u1",
    globalConfig,
    executionPolicy: executeScriptPolicy(globalConfig),
    isSuperUser: false,
    pathPolicy: resolvePathPolicy(),
    ...overrides,
  };
}

test("resolveRuntimePathContext requires every explicit protocol input", () => {
  assert.throws(
    () => resolveRuntimePathContext(pathContextInput({ hostRootDirectory: "" })),
    /requires hostRootDirectory/,
  );
  assert.throws(
    () => resolveRuntimePathContext(pathContextInput({ userId: "" })),
    /requires userId/,
  );
  assert.throws(
    () => resolveRuntimePathContext(pathContextInput({ isSuperUser: undefined })),
    /requires boolean isSuperUser/,
  );
  assert.throws(
    () => resolveRuntimePathContext(pathContextInput({ pathPolicy: {} })),
    /path policy must be created by resolvePathPolicy/,
  );
});

test("resolveRuntimePathContext projects host directories", () => {
  const hostContext = resolveRuntimePathContext(pathContextInput());
  assert.equal(hostContext.view, "host");
  assert.equal(hostContext.sandbox, null);
  assert.equal(hostContext.directories.currentDirectory, "/host/workspaces/u1");
  assert.equal(hostContext.directories.rootDirectory, "/host/workspaces/u1");
  assert.equal(hostContext.directories.opsWorkdir, "/host/workspaces/u1/runtime/ops_workdir");
  assert.deepEqual(hostContext.directories.allowedRoots, ["/host/workspaces/u1"]);
  assert.equal(Object.hasOwn(hostContext.directories, "hostAbsolutePaths"), false);
});

test("resolveRuntimePathContext reads super admin host roots from path policy", () => {
  const pathPolicy = resolvePathPolicy();
  const superContext = resolveRuntimePathContext(
    pathContextInput({ isSuperUser: true, pathPolicy }),
  );
  assert.deepEqual(superContext.directories.allowedRoots, resolveSuperAdminHostRoots(pathPolicy));
  assert.equal(superContext.directories.hostAbsolutePaths, true);
});

test("resolveRuntimePathContext projects sandbox layout per container scope", () => {
  const userScopeConfig = {
    security: {
      executionIsolation: {
        mode: "sandbox",
        sandbox: {
          provider: "docker",
          scope: "user",
          mounts: [{ source: "/host/data", target: "/data" }],
        },
      },
    },
  };
  const userScope = resolveRuntimePathContext(pathContextInput({ globalConfig: userScopeConfig }));
  assert.equal(userScope.view, "sandbox");
  assert.equal(userScope.sandbox.scope, "user");
  assert.equal(userScope.sandbox.root, "/workspace");
  assert.deepEqual(
    userScope.sandbox.pathMappings.map((item) => item.source),
    ["/host/data"],
  );
  assert.equal(userScope.directories.rootDirectory, "/workspace");
  assert.equal(userScope.directories.opsWorkdir, "/workspace/runtime/ops_workdir");
  assert.deepEqual([...userScope.directories.allowedRoots].sort(), ["/data", "/workspace"]);

  const globalScopeConfig = {
    security: {
      executionIsolation: {
        mode: "sandbox",
        sandbox: { provider: "docker", scope: "global" },
      },
    },
  };
  const globalScope = resolveRuntimePathContext(
    pathContextInput({ userId: "primary-user", globalConfig: globalScopeConfig }),
  );
  assert.equal(globalScope.sandbox.scope, "global");
  assert.equal(globalScope.directories.rootDirectory, "/workspace/primary-user");
  assert.equal(globalScope.directories.opsWorkdir, "/workspace/primary-user/runtime/ops_workdir");
});

test("resolveRuntimeOpsWorkdir is the single ops workdir source for both views", () => {
  const sandboxConfig = {
    security: {
      executionIsolation: { mode: "sandbox", sandbox: { provider: "docker", scope: "global" } },
    },
  };
  assert.deepEqual(
    resolveRuntimeOpsWorkdir({
      hostRootDirectory: "/host/workspaces/u1",
      userId: "u1",
      executionPolicy: executeScriptPolicy(),
    }),
    { view: "host", opsWorkdir: "/host/workspaces/u1/runtime/ops_workdir" },
  );
  assert.deepEqual(
    resolveRuntimeOpsWorkdir({
      hostRootDirectory: "/host/workspaces/u1",
      userId: "u1",
      executionPolicy: executeScriptPolicy(sandboxConfig),
    }),
    { view: "sandbox", opsWorkdir: "/workspace/u1/runtime/ops_workdir" },
  );
});

test("sandbox mount targets are shared by all file-related tools through global isolation config", () => {
  const hostProject = resolveToolInputPath({
    inputPath: "/project/client/noobot-chat/src/app/App.vue",
    workspacePath: "/host/workspaces/u1/noobot",
    runtime: {
      basePath: "/host/workspaces/u1",
      globalConfig: { security: { executionIsolation: { mode: "host" } } },
    },
  });
  assert.equal(hostProject.ok, false);
  assert.equal(hostProject.error, "sandbox_path_not_allowed");

  const sandboxProject = resolveToolInputPath({
    inputPath: "/project/client/noobot-chat/src/app/App.vue",
    workspacePath: "/host/workspaces/u1/noobot",
    allowSandbox: true,
    runtime: {
      basePath: "/host/workspaces/u1/noobot",
      systemRuntime: { userId: "u1" },
      globalConfig: {
        security: {
          executionIsolation: {
            mode: "sandbox",
            sandbox: {
              provider: "docker",
              scope: "global",
              mounts: [
                {
                  source: "/host/projects/noobot",
                  target: "/project",
                  readOnly: true,
                },
              ],
            },
          },
        },
      },
    },
  });
  assert.equal(sandboxProject.ok, true);
  assert.equal(
    sandboxProject.resolvedPath,
    "/host/projects/noobot/client/noobot-chat/src/app/App.vue",
  );
  assert.equal(sandboxProject.logicalPath, "/project/client/noobot-chat/src/app/App.vue");
  assert.equal(sandboxProject.executionRoot, "/host/projects/noobot");
  assert.equal(sandboxProject.mountTarget, "/project");
  assert.equal(sandboxProject.mountReadOnly, true);

  const arbitraryMount = resolveToolInputPath({
    inputPath: "/shared-assets/images/a.png",
    workspacePath: "/host/workspaces/u1/noobot",
    allowSandbox: true,
    runtime: {
      basePath: "/host/workspaces/u1/noobot",
      systemRuntime: { userId: "u1" },
      globalConfig: {
        security: {
          executionIsolation: {
            mode: "sandbox",
            sandbox: {
              provider: "docker",
              scope: "global",
              mounts: [{ source: "/host/assets", target: "/shared-assets" }],
            },
          },
        },
      },
    },
  });
  assert.equal(arbitraryMount.ok, true);
  assert.equal(arbitraryMount.resolvedPath, "/host/assets/images/a.png");
  assert.equal(arbitraryMount.logicalPath, "/shared-assets/images/a.png");
});

test("sandbox paths require an explicit sandbox-capable caller", () => {
  const resolvedPath = resolveToolInputPath({
    inputPath: "/workspace/primary-user/src/a.js",
    workspacePath: "/host/workspaces/primary-user",
    runtime: {
      basePath: "/host/workspaces/primary-user",
      systemRuntime: { userId: "primary-user" },
      globalConfig: {
        tools: {
          execute_script: { execution: { view: "sandbox" } },
        },
      },
    },
  });
  assert.equal(resolvedPath.ok, false);
  assert.equal(resolvedPath.error, "sandbox_path_not_allowed");
});
