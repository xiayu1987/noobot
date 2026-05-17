/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import path from "node:path";

export function buildFirejailCommand({ userRoot, command }) {
  const homeDir = path.join(userRoot, "runtime/sandbox/firejail/home");
  const persistDir = "$HOME/runtime/sandbox/persist";
  const cmd = [
    "mkdir -p",
    JSON.stringify(homeDir),
    "&&",
    "firejail",
    "--quiet",
    "--noprofile",
    "--private=" + JSON.stringify(homeDir),
    "--private-tmp",
    "--private-cache",
    "--",
    "bash",
    "-lc",
    JSON.stringify(
      `mkdir -p "${persistDir}" && cd "${persistDir}" && ${command}`,
    ),
  ].join(" ");
  return { cmd, homeDir, persistDir };
}
