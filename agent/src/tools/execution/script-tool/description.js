/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { tTool } from "../../core/tool-i18n.js";
import { resolveCommandShell } from "@noobot/execution-isolation-protocol";

export function buildScriptToolDescription({
  runtime,
  sandboxEnabled,
  sandboxProvider,
  basePath,
  pathContext,
  executionView,
  platform = process.platform,
}) {
  const commandShell = resolveCommandShell({ executionView, platform });
  if (!sandboxEnabled) {
    return [
      tTool(runtime, "tools.script.localModeTitle"),
      tTool(runtime, "tools.script.concise.lineShell", { shell: commandShell }),
      tTool(runtime, "tools.script.concise.lineWorkdir", { workdir: basePath }),
      tTool(runtime, "tools.script.localModePathHint"),
    ].join("\n");
  }

  const { directories, sandbox } = pathContext;
  const sandboxWorkdir = directories.currentDirectory;
  const extraMountRoots = directories.extraMountTargets;
  return [
    `${tTool(runtime, "tools.script.workspaceSandboxTitlePrefix")}${sandboxProvider}${tTool(runtime, "tools.script.workspaceSandboxTitleSuffix")}`,
    tTool(runtime, "tools.script.concise.lineShell", { shell: commandShell }),
    tTool(runtime, "tools.script.concise.lineWorkdir", { workdir: sandboxWorkdir }),
    tTool(runtime, "tools.script.concise.lineRelativeBase", { workdir: sandboxWorkdir }),
    tTool(runtime, "tools.script.concise.linePaths", { root: sandbox.root }),
    ...(extraMountRoots.length
      ? [
          tTool(runtime, "tools.script.concise.lineExtraRoots", {
            roots: directories.allowedRoots.join(", "),
          }),
        ]
      : []),
  ].join("\n");
}
