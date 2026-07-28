/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
export async function resolveSkills({
  skillService = null,
  runtimeBasePath = "",
  userId = "",
} = {}) {
  if (!skillService || !runtimeBasePath) return [];
  return skillService.listSkills({ userId });
}
