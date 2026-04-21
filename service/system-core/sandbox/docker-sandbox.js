/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
export function buildDockerCommand({ userRoot, command }) {
  return `docker run --rm -v "${userRoot}:/workspace" -w /workspace/runtime/workspace node:20 bash -lc ${JSON.stringify(command)}`;
}
