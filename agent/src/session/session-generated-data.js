/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { filePath as path } from "@noobot/path-resolver";

export const SESSION_GENERATED_DATA_DIRS = Object.freeze({
  executeScriptForeground: ".execute-script-foreground",
  executeScriptBackground: ".execute-script-background",
  fileMutations: "file-mutations",
});

export function resolveSessionGeneratedDataRoot(sessionDir = "", kind = "") {
  const normalizedSessionDir = String(sessionDir || "").trim();
  const relativeDir = String(SESSION_GENERATED_DATA_DIRS[kind] || "").trim();
  if (!normalizedSessionDir) throw new Error("session directory is required");
  if (!relativeDir) throw new Error(`unsupported session generated data kind: ${String(kind || "")}`);
  return path.join(normalizedSessionDir, relativeDir);
}
