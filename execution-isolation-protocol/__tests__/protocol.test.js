/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import test from "node:test";
import assert from "node:assert/strict";
import {
  assertToolExecutionPolicy,
  EXECUTION_ISOLATION_PROTOCOL_NAME,
  EXECUTION_ISOLATION_PROTOCOL_VERSION,
  TOOL_EXECUTION_CLASS,
  TOOL_EXECUTION_VIEW,
  normalizeSandboxMounts,
  resolveExecutionIsolation,
  resolveSandboxMountMappings,
  resolveToolExecutionAuthorization,
  resolveToolExecutionPolicy,
  resolveWorkspaceSandboxLayout,
  resolveWorkspaceSandboxMountProjection,
} from "../src/index.js";

test("execution isolation owns tool classes and execution views", () => {
  const globalConfig = {
    security: { executionIsolation: { mode: "sandbox", sandbox: { provider: "docker" } } },
  };
  for (const toolName of ["read_file", "write_file", "patch_file", "search"]) {
    const policy = resolveToolExecutionPolicy({ toolName, globalConfig });
    assert.equal(policy.executionClass, TOOL_EXECUTION_CLASS.WORKSPACE_IO);
    assert.equal(policy.view, TOOL_EXECUTION_VIEW.SERVICE_HOST);
  }
  assert.equal(
    resolveToolExecutionPolicy({ toolName: "execute_script", globalConfig }).view,
    TOOL_EXECUTION_VIEW.WORKSPACE_SANDBOX,
  );
  assert.equal(
    resolveToolExecutionPolicy({ toolName: "execute_native_script", globalConfig }).view,
    TOOL_EXECUTION_VIEW.NATIVE_HOST_RESTRICTED,
  );
  const scriptPolicy = resolveToolExecutionPolicy({ toolName: "execute_script", globalConfig });
  assert.equal(assertToolExecutionPolicy(scriptPolicy), scriptPolicy);
  assert.throws(
    () =>
      assertToolExecutionPolicy({
        ...scriptPolicy,
        view: TOOL_EXECUTION_VIEW.SERVICE_HOST_RESTRICTED,
      }),
    /does not match/,
  );
});

test("host workspace compute requires super-admin authority", () => {
  const hostPolicy = resolveToolExecutionPolicy({
    toolName: "execute_script",
    globalConfig: { security: { executionIsolation: { mode: "host" } } },
  });
  assert.deepEqual(resolveToolExecutionAuthorization({ policy: hostPolicy }), {
    allowed: false,
    code: "host_compute_requires_super_admin",
  });
  assert.deepEqual(resolveToolExecutionAuthorization({ policy: hostPolicy, isSuperAdmin: true }), {
    allowed: true,
    code: "",
  });

  for (const scope of ["user", "global"]) {
    const sandboxPolicy = resolveToolExecutionPolicy({
      toolName: "execute_script",
      globalConfig: { security: { executionIsolation: { mode: "sandbox", sandbox: { scope } } } },
    });
    assert.deepEqual(resolveToolExecutionAuthorization({ policy: sandboxPolicy }), {
      allowed: true,
      code: "",
    });
  }
});

test("sandbox layout is the only workspace root and container identity projection", () => {
  const userIsolation = resolveExecutionIsolation({
    security: {
      executionIsolation: {
        mode: "sandbox",
        sandbox: { scope: "user", containerName: "Noobot Sandbox" },
      },
    },
  });
  assert.deepEqual(resolveWorkspaceSandboxLayout({ isolation: userIsolation, userId: "Admin A" }), {
    scope: "user",
    userIsolated: true,
    root: "/workspace",
    userPart: "admin-a",
    userRoot: "/workspace",
    opsWorkdir: "/workspace/runtime/ops_workdir",
    containerName: "noobot-sandbox-admin-a",
  });
  const globalIsolation = resolveExecutionIsolation({
    security: { executionIsolation: { mode: "sandbox", sandbox: { scope: "global" } } },
  });
  const globalLayout = resolveWorkspaceSandboxLayout({
    isolation: globalIsolation,
    userId: "Admin A",
  });
  assert.equal(globalLayout.scope, "global");
  assert.equal(globalLayout.userIsolated, false);
  assert.equal(globalLayout.userRoot, "/workspace/admin-a");
  assert.deepEqual(
    resolveWorkspaceSandboxMountProjection({
      isolation: userIsolation,
      userId: "Admin A",
      hostUserRoot: "/srv/workspaces/admin-a",
    }),
    { source: "/srv/workspaces/admin-a", target: "/workspace" },
  );
  assert.deepEqual(
    resolveWorkspaceSandboxMountProjection({
      isolation: globalIsolation,
      userId: "Admin A",
      hostUserRoot: "/srv/workspaces/admin-a",
    }),
    { source: "/srv/workspaces", target: "/workspace" },
  );
});

test("execution isolation result is versioned and deeply owns canonical mounts", () => {
  const globalConfig = {
    security: {
      executionIsolation: {
        mode: "sandbox",
        sandbox: {
          provider: "docker",
          scope: "global",
          mounts: [
            { source: "/srv/project", target: "/project/./data", description: "Project" },
            { source: "C:\\Media", target: "/media", readOnly: true },
          ],
        },
      },
    },
  };
  const isolation = resolveExecutionIsolation(globalConfig);
  assert.equal(isolation.protocol, EXECUTION_ISOLATION_PROTOCOL_NAME);
  assert.equal(isolation.version, EXECUTION_ISOLATION_PROTOCOL_VERSION);
  assert.deepEqual(isolation.sandbox.mounts, [
    {
      source: "/srv/project",
      target: "/project/data",
      description: "Project",
      readOnly: false,
    },
    { source: "C:\\Media", target: "/media", description: "", readOnly: true },
  ]);
  assert.deepEqual(resolveSandboxMountMappings(isolation), [
    { source: "/srv/project", target: "/project/data" },
    { source: "C:\\Media", target: "/media" },
  ]);
  assert.equal(Object.isFrozen(isolation.sandbox.mounts), true);
  assert.equal(Object.isFrozen(isolation.sandbox.mounts[0]), true);
});

test("mount protocol rejects ambiguous or unsafe mount declarations", () => {
  assert.throws(() => normalizeSandboxMounts([{}]), /source is required/);
  assert.throws(
    () => normalizeSandboxMounts([{ source: "relative", target: "/data" }]),
    /absolute host path/,
  );
  assert.throws(
    () => normalizeSandboxMounts([{ source: "/srv/data", target: "relative" }]),
    /absolute container path/,
  );
  assert.throws(
    () => normalizeSandboxMounts([{ source: "/srv/data", target: "/workspace/data" }]),
    /managed workspace mount/,
  );
  assert.throws(
    () =>
      normalizeSandboxMounts([
        { source: "/srv/a", target: "/data" },
        { source: "/srv/b", target: "/data" },
      ]),
    /duplicated/,
  );
});

test("execution isolation rejects invalid provider, scope, mode, and queue timeout", () => {
  assert.throws(
    () => resolveExecutionIsolation({ security: { executionIsolation: { mode: "automatic" } } }),
    /invalid execution isolation mode/,
  );
  assert.throws(
    () =>
      resolveExecutionIsolation({
        security: { executionIsolation: { sandbox: { provider: "firejail" } } },
      }),
    /invalid workspace sandbox provider/,
  );
  assert.throws(
    () =>
      resolveExecutionIsolation({
        security: { executionIsolation: { sandbox: { scope: "per-user" } } },
      }),
    /invalid workspace sandbox scope/,
  );
  assert.throws(
    () =>
      resolveExecutionIsolation({
        security: { executionIsolation: { sandbox: { lockWaitTimeoutMs: 99 } } },
      }),
    /integer >= 100/,
  );
});
