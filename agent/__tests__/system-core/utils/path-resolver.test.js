/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import test from "node:test";
import assert from "node:assert/strict";

import {
  PATH_PLATFORMS,
  PATH_VIEWS,
  TOOL_PATH_VIEWS,
  classifyToolInputPath,
  convertPathView,
  detectPathPlatform,
  isAbsolutePathAnyPlatform,
  isAbsolutePathForPlatform,
  isCaseInsensitivePathContext,
  isCaseInsensitivePathPlatform,
  joinPathForPlatform,
  normalizePathForPlatform,
  resolvePathPlatformFromContext,
  resolvePathUnderRoot,
  resolveAgentPathContext,
  resolveRuntimePathContext,
  resolveToolPathPolicy,
  resolveToolInputPath,
} from "../../../src/system-core/utils/path-resolver.js";

test("detects foreign platform paths without using process.platform", () => {
  assert.equal(detectPathPlatform("C:\\Users\\张三\\file.txt"), PATH_PLATFORMS.WINDOWS);
  assert.equal(detectPathPlatform("\\\\server\\share\\file.txt"), PATH_PLATFORMS.WINDOWS);
  assert.equal(detectPathPlatform("/Users/test/file.txt", "macos"), PATH_PLATFORMS.MACOS);
  assert.equal(detectPathPlatform("/home/test/file.txt"), "");
  assert.equal(detectPathPlatform("/Users/test/file.txt"), "");
});

test("converts explicit host, sandbox and client views while retaining semantics", () => {
  const mappings = [{ client: "C:/Users/me/project", host: "/srv/project", sandbox: "/workspace/project" }];
  const sandbox = convertPathView({ path: "C:\\Users\\me\\project\\文 件.txt", sourcePlatform: "windows", sourceView: "client", targetPlatform: "linux", targetView: "sandbox", mappings });
  assert.equal(sandbox.path, "/workspace/project/文 件.txt");
  assert.equal(sandbox.sourcePlatform, PATH_PLATFORMS.WINDOWS);
  assert.equal(sandbox.sourceView, PATH_VIEWS.CLIENT);
  assert.equal(sandbox.targetView, PATH_VIEWS.SANDBOX);
  const client = convertPathView({ path: sandbox.path, sourcePlatform: "linux", sourceView: "sandbox", targetPlatform: "windows", targetView: "client", mappings });
  assert.equal(client.path, "C:/Users/me/project/文 件.txt");
});

test("keeps an unmapped path and marks conversion as unmapped", () => {
  const result = convertPathView({ path: "/outside/file", sourceView: "host", targetView: "client", sourcePlatform: "linux", targetPlatform: "macos" });
  assert.equal(result.path, "/outside/file");
  assert.equal(result.mapped, false);
});

test("uses the recorded server platform for host views", () => {
  const agentContext = { environment: { os: { platform: "win32" } } };
  const fromHost = convertPathView({
    path: "C:\\work\\file.txt",
    sourceView: "host",
    targetView: "client",
    agentContext,
  });
  assert.equal(fromHost.sourcePlatform, PATH_PLATFORMS.WINDOWS);

  const toHost = convertPathView({
    path: "/client/file.txt",
    sourceView: "client",
    sourcePlatform: "macos",
    targetView: "host",
    agentContext,
  });
  assert.equal(toHost.targetPlatform, PATH_PLATFORMS.WINDOWS);
});

test("explicit platforms override the recorded host platform", () => {
  const result = convertPathView({
    path: "/srv/file.txt",
    sourceView: "host",
    sourcePlatform: "linux",
    targetView: "host",
    targetPlatform: "macos",
    agentContext: { environment: { os: { platform: "win32" } } },
  });
  assert.equal(result.sourcePlatform, PATH_PLATFORMS.LINUX);
  assert.equal(result.targetPlatform, PATH_PLATFORMS.MACOS);
});

test("normalizes drive, UNC, file URL and dot segments", () => {
  assert.equal(normalizePathForPlatform("C:\\Users\\me\\..\\you\\文 件.txt"), "C:/Users/you/文 件.txt");
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

test("resolves path platform and case-sensitivity from context", () => {
  assert.equal(resolvePathPlatformFromContext({ environment: { os: { platform: "win32" } } }), PATH_PLATFORMS.WINDOWS);
  assert.equal(resolvePathPlatformFromContext({ environment: { platform: "darwin" } }), PATH_PLATFORMS.MACOS);
  assert.equal(isCaseInsensitivePathPlatform("windows"), true);
  assert.equal(isCaseInsensitivePathPlatform("darwin"), true);
  assert.equal(isCaseInsensitivePathPlatform("linux"), false);
  assert.equal(isCaseInsensitivePathContext({ environment: { os: { platform: "win32" } } }), true);
});

test("resolves relative targets under root without corrupting foreign absolute paths", () => {
  assert.equal(resolvePathUnderRoot("/workspace/app", "src/file.js"), "/workspace/app/src/file.js");
  assert.equal(resolvePathUnderRoot("C:\\work\\app", "src\\file.js"), "C:/work/app/src/file.js");
  assert.equal(resolvePathUnderRoot("/workspace/app", "C:\\work\\src\\file.js"), "C:/work/src/file.js");
  assert.equal(resolvePathUnderRoot("/workspace/app", "file:///C:/work/src/file.js"), "C:/work/src/file.js");
  assert.equal(resolvePathUnderRoot("/workspace/app", "\\\\server\\share\\file.js"), "//server/share/file.js");
});

test("classifies tool input path views explicitly", () => {
  assert.equal(classifyToolInputPath("i18n/src/a.js").view, TOOL_PATH_VIEWS.WORKSPACE_RELATIVE);
  assert.equal(classifyToolInputPath("/workspace/u1/a.js").view, TOOL_PATH_VIEWS.SANDBOX_ABSOLUTE);
  assert.equal(classifyToolInputPath("/project/a.js").view, TOOL_PATH_VIEWS.SANDBOX_ABSOLUTE);
  assert.equal(classifyToolInputPath("project/a.js").view, TOOL_PATH_VIEWS.VIRTUAL_RELATIVE);
  assert.equal(classifyToolInputPath("C:\\work\\a.js").view, TOOL_PATH_VIEWS.HOST_ABSOLUTE);
});

test("resolves tool input paths across workspace sandbox and host views", () => {
  const runtime = {
    basePath: "/workspace-root/u1",
    userId: "u1",
    globalConfig: {
      tools: {
        execute_script: {
          sandboxMode: true,
          sandboxProvider: {
            default: "docker",
            docker: { dockerContainerScope: "global" },
          },
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
  assert.equal(sandboxAbsolute.ok, true);
  assert.equal(sandboxAbsolute.view, TOOL_PATH_VIEWS.SANDBOX_ABSOLUTE);
  assert.equal(sandboxAbsolute.resolvedPath, "/workspace-root/u1/src/a.js");

  const dockerUserSandboxAbsolute = resolveToolInputPath({
    inputPath: "/workspace/src/a.js",
    runtime: {
      ...runtime,
      globalConfig: {
        tools: {
          execute_script: {
            sandboxMode: true,
            sandboxProvider: {
              default: "docker",
              docker: { dockerContainerScope: "user" },
            },
          },
        },
      },
    },
    agentContext,
    workspacePath: "/workspace-root/u1",
    workspaceRoot: "/workspace-root",
  });
  assert.equal(dockerUserSandboxAbsolute.ok, true);
  assert.equal(dockerUserSandboxAbsolute.resolvedPath, "/workspace-root/u1/src/a.js");

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
  assert.equal(virtualRelative.candidateSandboxPath, "/project/src/a.js");

  const hostAbsolute = resolveToolInputPath({
    inputPath: "C:\\outside\\a.js",
    runtime,
    agentContext: { environment: { os: { platform: "win32" }, workspace: { basePath: "/workspace-root/u1" } } },
    workspacePath: "/workspace-root/u1",
    allowHostAbsolute: true,
  });
  assert.equal(hostAbsolute.ok, true);
  assert.equal(hostAbsolute.view, TOOL_PATH_VIEWS.HOST_ABSOLUTE);
  assert.equal(hostAbsolute.resolvedPath, "C:/outside/a.js");
});

test("resolves runtime path context from active sandbox configuration only", () => {
  const hostContext = resolveRuntimePathContext({
    runtimeBasePath: "/host/workspaces/u1",
    workspaceRoot: "/host/workspaces",
    userId: "u1",
  });
  assert.equal(hostContext.view, "host");
  assert.equal(hostContext.directories.rootDirectory, "/host/workspaces/u1");
  assert.equal(hostContext.directories.opsWorkdir, "/host/workspaces/u1/runtime/ops_workdir");
  assert.deepEqual(hostContext.directories.allowedRoots, ["/host/workspaces/u1"]);

  const dockerUserContext = resolveRuntimePathContext({
    runtimeBasePath: "/host/workspaces/u1",
    workspaceRoot: "/host/workspaces",
    userId: "u1",
    effectiveConfig: {
      tools: {
        sandboxPathMappings: [{ source: "/host/project", target: "/project" }],
        execute_script: {
          sandboxMode: true,
          sandboxProvider: {
            default: "docker",
            docker: {
              dockerContainerScope: "user",
              dockerMounts: [{ source: "/host/data", target: "/data" }],
            },
          },
        },
      },
    },
  });
  assert.equal(dockerUserContext.view, "sandbox");
  assert.equal(dockerUserContext.isDockerGlobal, false);
  assert.equal(dockerUserContext.directories.rootDirectory, "/workspace");
  assert.equal(dockerUserContext.directories.opsWorkdir, "/workspace/runtime/ops_workdir");
  assert.deepEqual(dockerUserContext.directories.allowedRoots.sort(), ["/data", "/project", "/workspace"]);
  assert.deepEqual(dockerUserContext.hostMountSources.sort(), ["/host/data", "/host/project"]);

  const dockerGlobalContext = resolveRuntimePathContext({
    runtimeBasePath: "/host/workspaces/primary-user",
    workspaceRoot: "/host/workspaces",
    userId: "primary-user",
    effectiveConfig: {
      tools: {
        execute_script: {
          sandboxMode: true,
          sandboxProvider: {
            default: "docker",
            docker: { dockerContainerScope: "global" },
          },
        },
      },
    },
  });
  assert.equal(dockerGlobalContext.isDockerGlobal, true);
  assert.equal(dockerGlobalContext.sandboxRoot, "/workspace");
  assert.equal(dockerGlobalContext.directories.rootDirectory, "/workspace/primary-user");
  assert.equal(dockerGlobalContext.directories.opsWorkdir, "/workspace/primary-user/runtime/ops_workdir");

  const bubblewrapContext = resolveRuntimePathContext({
    runtimeBasePath: "/host/workspaces/u1",
    userId: "u1",
    effectiveConfig: {
      tools: {
        execute_script: {
          sandboxMode: true,
          sandboxProvider: { default: "bubblewrap", bubblewrap: {} },
        },
      },
    },
  });
  assert.equal(bubblewrapContext.sandboxProvider, "bubblewrap");
  assert.equal(bubblewrapContext.directories.rootDirectory, "/workspace");
  assert.equal(bubblewrapContext.directories.opsWorkdir, "/workspace/runtime/sandbox/persist");

  const firejailContext = resolveRuntimePathContext({
    runtimeBasePath: "/host/workspaces/u1",
    userId: "u1",
    effectiveConfig: {
      tools: {
        execute_script: {
          sandboxMode: true,
          sandboxProvider: { default: "firejail", firejail: {} },
        },
      },
    },
  });
  assert.equal(firejailContext.sandboxProvider, "firejail");
  assert.equal(firejailContext.directories.rootDirectory, "$HOME");
  assert.equal(firejailContext.directories.opsWorkdir, "$HOME/runtime/sandbox/persist");
});

test("resolves agent path contract from system directories without mixing sandbox and host views", () => {
  const hostContext = resolveAgentPathContext({
    runtime: {
      basePath: "/host/workspaces/u1",
      systemRuntime: {
        staticInfo: {
          directories: {
            view: "host",
            rootDirectory: "/host/workspaces/u1/noobot",
            currentDirectory: "/host/workspaces/u1/noobot",
            opsWorkdir: "/host/workspaces/u1/noobot/runtime/ops_workdir",
            allowedRoots: ["/host/workspaces/u1"],
          },
        },
      },
    },
    runtimeBasePath: "/host/workspaces/u1",
  });
  assert.equal(hostContext.view, "host");
  assert.equal(hostContext.rootDirectory, "/host/workspaces/u1/noobot");
  assert.equal(hostContext.hostRootDirectory, "/host/workspaces/u1/noobot");
  assert.deepEqual(hostContext.hostAllowedRoots, ["/host/workspaces/u1"]);

  const sandboxContext = resolveAgentPathContext({
    runtime: {
      basePath: "/host/workspaces/u1",
      globalConfig: {
        tools: {
          execute_script: {
            sandboxMode: true,
            sandboxProvider: {
              default: "docker",
              docker: { dockerContainerScope: "global" },
            },
          },
        },
      },
      systemRuntime: {
        staticInfo: {
          directories: {
            view: "sandbox",
            rootDirectory: "/workspace/u1",
            opsWorkdir: "/workspace/u1/runtime/ops_workdir",
            allowedRoots: ["/workspace"],
          },
        },
      },
    },
    runtimeBasePath: "/host/workspaces/u1",
    userId: "u1",
  });
  assert.equal(sandboxContext.view, "sandbox");
  assert.equal(sandboxContext.rootDirectory, "/workspace/u1");
  assert.equal(sandboxContext.hostRootDirectory, "/host/workspaces/u1");
  assert.deepEqual(sandboxContext.hostAllowedRoots, []);
});

test("resolves tool path policy with separate relative root and allowed roots", () => {
  const policy = resolveToolPathPolicy({
    runtime: {
      basePath: "/host/workspaces/u1",
      systemRuntime: {
        staticInfo: {
          directories: {
            view: "host",
            rootDirectory: "/host/workspaces/u1/noobot",
            allowedRoots: ["/host/workspaces/u1"],
          },
        },
      },
    },
    runtimeBasePath: "/host/workspaces/u1",
    workspacePath: "/host/workspaces/u1",
    workspaceRoot: "/host/workspaces",
    isSuperUser: false,
  });
  assert.equal(policy.relativeHostRoot, "/host/workspaces/u1/noobot");
  assert.deepEqual(policy.allowedRoots, ["/host/workspaces/u1"]);
  assert.equal(policy.superUserBypassesDirectoryScope, false);
});

test("resolves /project as rootDirectory compatibility only when sandbox is disabled", () => {
  const hostProject = resolveToolInputPath({
    inputPath: "/project/client/noobot-chat/src/app/App.vue",
    workspacePath: "/host/workspaces/u1/noobot",
    workspaceRoot: "/host/workspaces",
    runtime: {
      basePath: "/host/workspaces/u1",
      globalConfig: {
        tools: {
          execute_script: { sandboxMode: false },
        },
      },
    },
  });
  assert.equal(hostProject.ok, true);
  assert.equal(hostProject.resolvedPath, "/host/workspaces/u1/noobot/client/noobot-chat/src/app/App.vue");

  const sandboxProject = resolveToolInputPath({
    inputPath: "/project/client/noobot-chat/src/app/App.vue",
    workspacePath: "/host/workspaces/u1/noobot",
    workspaceRoot: "/host/workspaces",
    runtime: {
      basePath: "/host/workspaces/u1/noobot",
      globalConfig: {
        tools: {
          execute_script: {
            sandboxMode: true,
            sandboxProvider: {
              default: "docker",
              docker: { dockerContainerScope: "global" },
            },
          },
        },
      },
    },
  });
  assert.equal(sandboxProject.ok, false);
  assert.equal(sandboxProject.error, "sandbox_path_not_mapped");
});

test("resolves docker global sandbox user root from systemRuntime userId", () => {
  const resolvedPath = resolveToolInputPath({
    inputPath: "/workspace/primary-user/src/a.js",
    workspacePath: "/host/workspaces/primary-user",
    workspaceRoot: "/host/workspaces",
    runtime: {
      basePath: "/host/workspaces/primary-user",
      systemRuntime: { userId: "primary-user" },
      globalConfig: {
        tools: {
          execute_script: {
            sandboxMode: true,
            sandboxProvider: {
              default: "docker",
              docker: { dockerContainerScope: "global" },
            },
          },
        },
      },
    },
  });
  assert.equal(resolvedPath.ok, true);
  assert.equal(resolvedPath.resolvedPath, "/host/workspaces/primary-user/src/a.js");
});
