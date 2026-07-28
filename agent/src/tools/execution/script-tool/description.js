/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { tTool } from "../../core/tool-i18n.js";

export function buildScriptToolDescription({
  runtime,
  sandboxEnabled,
  sandboxProvider,
  workspace,
  pathContext = {},
}) {
  if (!sandboxEnabled) {
    return [
      tTool(runtime, "tools.script.localModeTitle"),
      tTool(runtime, "tools.script.concise.lineWorkdir", { workdir: workspace }),
      tTool(runtime, "tools.script.localModePathHint"),
    ].join("\n");
  }

  const directories =
    pathContext?.directories && typeof pathContext.directories === "object"
      ? pathContext.directories
      : {};
  const sandboxWorkdir = directories.opsWorkdir || pathContext?.opsWorkdir || workspace;
  const sandboxRoot = pathContext?.sandboxRoot || directories.rootDirectory || "";
  const allowedRoots = Array.isArray(directories.allowedRoots)
    ? directories.allowedRoots
    : Array.isArray(pathContext?.allowedRoots)
      ? pathContext.allowedRoots
      : [sandboxRoot].filter(Boolean);
  const extraMountRoots = Array.isArray(directories.extraMountTargets)
    ? directories.extraMountTargets
    : Array.isArray(pathContext?.extraMountTargets)
      ? pathContext.extraMountTargets
      : [];

  return [
    `${tTool(runtime, "tools.script.sandboxModeTitlePrefix")}${sandboxProvider}${tTool(runtime, "tools.script.sandboxModeTitleSuffix")}`,
    tTool(runtime, "tools.script.concise.lineWorkdir", { workdir: sandboxWorkdir }),
    tTool(runtime, "tools.script.concise.lineRelativeBase", { workdir: sandboxWorkdir }),
    tTool(runtime, "tools.script.concise.linePaths", { root: sandboxRoot }),
    ...(extraMountRoots.length
      ? [
          tTool(runtime, "tools.script.concise.lineExtraRoots", {
            roots: allowedRoots.join(", "),
          }),
        ]
      : []),
  ].join("\n");
}
