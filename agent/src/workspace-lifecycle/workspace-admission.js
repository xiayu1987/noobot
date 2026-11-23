/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { AsyncLocalStorage } from "node:async_hooks";
import { createWorkspaceMaintenanceError } from "@noobot/workspace-protocol";
import { text } from "@noobot/shared/value";

export function createWorkspaceAdmission(releaseRetainedState, verifyWorkspace) {
  const scopes = new Map();
  const context = new AsyncLocalStorage();

  function key(userId) {
    const id = text(userId);
    if (!id) throw new TypeError("Workspace admission requires userId");
    return id;
  }

  function holdsScope(scope, lease) {
    for (; lease; lease = lease.parent) {
      if (lease.active && lease.scope === scope) return true;
    }
    return false;
  }

  function releaseLease(id, lease) {
    const { scope } = lease;
    lease.active = false;
    scope.active -= 1;
    if (scope.active) return;
    if (scope.maintenance) scope.maintenance.drained?.();
    else scopes.delete(id);
  }

  async function run(userId, operation) {
    const id = key(userId);
    let scope = scopes.get(id);
    const parent = context.getStore();
    if (scope?.maintenance && !holdsScope(scope, parent)) throw createWorkspaceMaintenanceError(id);
    if (!scope) {
      scope = { active: 0, maintenance: null };
      scopes.set(id, scope);
    }
    scope.active += 1;
    const lease = { scope, active: true, parent };
    try {
      if (!holdsScope(scope, parent)) await verifyWorkspace?.(id);
      return await context.run(lease, operation);
    } finally {
      releaseLease(id, lease);
    }
  }

  async function withMaintenance(userId, operation) {
    const id = key(userId);
    const scope = scopes.get(id) ?? { active: 0, maintenance: null };
    if (scope.maintenance?.running || holdsScope(scope, context.getStore()))
      throw createWorkspaceMaintenanceError(id);
    scopes.set(id, scope);
    const maintenance = { running: true, drained: null };
    scope.maintenance = maintenance;
    try {
      if (scope.active)
        await new Promise((resolve) => {
          maintenance.drained = resolve;
        });
      await releaseRetainedState(id);
      const result = await operation();
      scopes.delete(id);
      return result;
    } finally {
      maintenance.drained = null;
      maintenance.running = false;
    }
  }

  return Object.freeze({ run, withMaintenance });
}
