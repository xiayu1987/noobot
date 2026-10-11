/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import path from "node:path";

function readOption(argv, name) {
  const prefix = `--${name}=`;
  return argv.find((arg) => arg.startsWith(prefix))?.slice(prefix.length);
}

export function parseMigrationArgs(argv = process.argv) {
  const write = argv.includes("--write");
  const backupRoot = readOption(argv, "backup");
  if (write && !backupRoot) throw new Error("--write requires --backup=<directory>");
  return {
    workspaceRoot: path.resolve(readOption(argv, "workspace") || "workspace"),
    write,
    backupRoot: backupRoot ? path.resolve(backupRoot) : "",
  };
}
