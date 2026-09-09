/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import assert from "node:assert/strict";
import test from "node:test";
import {
  EXECUTION_ISOLATION_MODE,
  SANDBOX_PROVIDER,
  SANDBOX_PROVIDER_EXECUTABLE,
  TOOL_EXECUTION_VIEW,
  isHostIsolationMode,
  isRestrictedHostExecutionView,
  isSandboxExecutionView,
  isSandboxIsolationMode,
  resolveSandboxProviderExecutable,
} from "../src/index.js";
import {
  isRestrictedHostExecutionView as viewPredicateFromSubpath,
  isSandboxExecutionView as sandboxViewFromSubpath,
} from "../src/execution-views.js";

test("execution view predicates accept exactly their own view", () => {
  assert.equal(isSandboxExecutionView(TOOL_EXECUTION_VIEW.WORKSPACE_SANDBOX), true);
  assert.equal(isSandboxExecutionView(TOOL_EXECUTION_VIEW.SERVICE_HOST), false);
  assert.equal(isSandboxExecutionView(TOOL_EXECUTION_VIEW.SERVICE_HOST_RESTRICTED), false);
  assert.equal(isRestrictedHostExecutionView(TOOL_EXECUTION_VIEW.SERVICE_HOST_RESTRICTED), true);
  assert.equal(isRestrictedHostExecutionView(TOOL_EXECUTION_VIEW.SERVICE_HOST), false);
  assert.equal(isRestrictedHostExecutionView(TOOL_EXECUTION_VIEW.NATIVE_HOST_RESTRICTED), false);
});

test("execution view predicates reject empty and unknown input without throwing", () => {
  for (const input of ["", "   ", undefined, null, "workspace-sandbox", "WORKSPACE_SANDBOX"]) {
    assert.equal(isSandboxExecutionView(input), false);
    assert.equal(isRestrictedHostExecutionView(input), false);
  }
});

test("execution view predicates only trim and stay case sensitive", () => {
  assert.equal(isSandboxExecutionView(` ${TOOL_EXECUTION_VIEW.WORKSPACE_SANDBOX} `), true);
  assert.equal(isSandboxExecutionView(TOOL_EXECUTION_VIEW.WORKSPACE_SANDBOX.toUpperCase()), false);
});

test("main entry and execution-views subpath expose the same view predicates", () => {
  assert.equal(sandboxViewFromSubpath, isSandboxExecutionView);
  assert.equal(viewPredicateFromSubpath, isRestrictedHostExecutionView);
});

test("isolation mode predicates are mutually exclusive over the mode vocabulary", () => {
  assert.equal(isSandboxIsolationMode(EXECUTION_ISOLATION_MODE.SANDBOX), true);
  assert.equal(isHostIsolationMode(EXECUTION_ISOLATION_MODE.SANDBOX), false);
  assert.equal(isHostIsolationMode(EXECUTION_ISOLATION_MODE.HOST), true);
  assert.equal(isSandboxIsolationMode(EXECUTION_ISOLATION_MODE.HOST), false);
});

test("isolation mode predicates normalize case and whitespace", () => {
  assert.equal(isSandboxIsolationMode(" SANDBOX "), true);
  assert.equal(isHostIsolationMode(" Host "), true);
  for (const input of ["", "  ", undefined, null, "sandboxed"]) {
    assert.equal(isSandboxIsolationMode(input), false);
    assert.equal(isHostIsolationMode(input), false);
  }
});

test("sandbox provider executable is registered for every known provider", () => {
  for (const provider of Object.values(SANDBOX_PROVIDER)) {
    assert.equal(typeof SANDBOX_PROVIDER_EXECUTABLE[provider], "string");
    assert.ok(SANDBOX_PROVIDER_EXECUTABLE[provider].length > 0);
    assert.equal(resolveSandboxProviderExecutable(provider), SANDBOX_PROVIDER_EXECUTABLE[provider]);
  }
});

test("resolveSandboxProviderExecutable defaults to docker and rejects unknown providers", () => {
  assert.equal(resolveSandboxProviderExecutable(), SANDBOX_PROVIDER_EXECUTABLE.docker);
  assert.equal(resolveSandboxProviderExecutable(SANDBOX_PROVIDER.DOCKER), "docker");
  assert.throws(() => resolveSandboxProviderExecutable("podman"));
});
