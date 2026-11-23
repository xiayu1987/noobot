/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
const WORKSPACE_MAINTENANCE = "WORKSPACE_MAINTENANCE";

export function createWorkspaceMaintenanceError(userId) {
  return Object.assign(new Error("Workspace maintenance has stopped admission"), {
    code: WORKSPACE_MAINTENANCE,
    statusCode: 503,
    details: { userId },
  });
}

export function isWorkspaceMaintenanceError(error) {
  return error?.code === WORKSPACE_MAINTENANCE;
}

const WORKSPACE_LAYOUT_UPGRADE_FAILED = "WORKSPACE_LAYOUT_UPGRADE_FAILED";

export function assertWorkspaceLayoutReady(upgrades) {
  const failures = upgrades.flatMap(({ id: stage, failed }) =>
    failed ? [{ stage, ...failed }] : [],
  );
  if (failures.length) {
    throw Object.assign(new Error(`Workspace layout upgrade blocked at ${failures[0].stage}`), {
      code: WORKSPACE_LAYOUT_UPGRADE_FAILED,
      details: { failures },
    });
  }
}

export function isWorkspaceLayoutUpgradeFailure(error) {
  return error?.code === WORKSPACE_LAYOUT_UPGRADE_FAILED;
}

export function listWorkspaceLayoutQuarantines(upgrades) {
  return upgrades.flatMap(({ id: stage, result }) =>
    (result?.quarantined ?? []).map(({ path, quarantinePath, error }) => ({
      stage,
      path,
      quarantinePath,
      code: error.code,
      message: error.message,
    })),
  );
}
