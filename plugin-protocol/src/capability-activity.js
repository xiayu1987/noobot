/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
export function defineCapabilityActivity(activityKind) {
  return requireCapabilityActivity({ activityKind });
}

export function requireCapabilityActivity(value) {
  if (value === null) return null;
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError("capability activity must be an object or null");
  }
  if (Object.keys(value).some((key) => key !== "activityKind")) {
    throw new TypeError("capability activity contains unsupported fields");
  }
  if (typeof value.activityKind !== "string" || !value.activityKind.trim()) {
    throw new TypeError("capability activityKind must be a non-empty string");
  }
  return Object.freeze({ activityKind: value.activityKind.trim() });
}
