/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
export async function resolveLongMemory({ memoryService = null, userId = "" } = {}) {
  if (!memoryService) return "";
  return memoryService.readLongMemory({ userId });
}
