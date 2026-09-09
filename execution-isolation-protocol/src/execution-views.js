/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

export const TOOL_EXECUTION_VIEW = Object.freeze({
  WORKSPACE_SANDBOX: "workspace_sandbox",
  SERVICE_HOST: "service_host",
  SERVICE_HOST_RESTRICTED: "service_host_restricted",
  NATIVE_HOST_RESTRICTED: "native_host_restricted",
});

function normalizeExecutionView(input = "") {
  return String(input || "").trim();
}

export function isSandboxExecutionView(executionView = "") {
  return normalizeExecutionView(executionView) === TOOL_EXECUTION_VIEW.WORKSPACE_SANDBOX;
}

export function isRestrictedHostExecutionView(executionView = "") {
  return normalizeExecutionView(executionView) === TOOL_EXECUTION_VIEW.SERVICE_HOST_RESTRICTED;
}
