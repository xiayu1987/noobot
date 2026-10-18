/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { resolvePathPolicy } from "@noobot/path-resolver";
import { isPlainObject } from "@noobot/shared/value";

export function resolveConfiguredPathPolicy(globalConfig = {}) {
  if (!isPlainObject(globalConfig)) {
    throw new TypeError("global config must be an object");
  }
  const security = globalConfig.security === undefined ? {} : globalConfig.security;
  if (!isPlainObject(security)) {
    throw new TypeError("security config must be an object");
  }
  return resolvePathPolicy({
    policyOverride: security.pathPolicy,
    trustedDirectories: security.trustedDirectories,
  });
}
