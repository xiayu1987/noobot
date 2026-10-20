/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

import { isPlainObject, text } from "@noobot/shared/value";

export const SUPER_ADMIN_ROLE = "super_admin";

export function resolveConfiguredSuperUserId(globalConfig = {}) {
  if (!isPlainObject(globalConfig)) return "";
  return text(globalConfig.superAdmin?.userId);
}

export function isConfiguredSuperUser({ globalConfig = {}, userId = "" } = {}) {
  const configuredSuperUserId = resolveConfiguredSuperUserId(globalConfig);
  if (!configuredSuperUserId) return false;
  return text(userId) === configuredSuperUserId;
}

export function isSuperAdminRole(role = "") {
  return text(role) === SUPER_ADMIN_ROLE;
}

export function isSuperUserAgentContext(agentContext = {}) {
  return agentContext?.bindings?.runtime?.systemRuntime?.isSuperUser === true;
}
