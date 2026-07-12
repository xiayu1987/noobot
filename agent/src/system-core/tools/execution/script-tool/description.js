/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import {
  normalizeDockerContainerScope,
  normalizeDockerMounts,
} from "../../../sandbox/docker-sandbox.js";
import { tTool } from "../../core/tool-i18n.js";
import { SANDBOX_PROVIDER_NAME } from "./constants.js";

export function buildScriptToolDescription({
  runtime,
  sandboxEnabled,
  sandboxProvider,
  workspace,
  dockerConfig = {},
  userId = "",
}) {
  if (!sandboxEnabled) {
    return [
      tTool(runtime, "tools.script.localModeTitle"),
      tTool(runtime, "tools.script.concise.lineWorkdir", { workdir: workspace }),
      tTool(runtime, "tools.script.localModePathHint"),
    ].join("\n");
  }

  const dockerScope = normalizeDockerContainerScope(dockerConfig);
  const normalizedUserId = String(userId || "").trim().replace(/[^a-zA-Z0-9_.-]/g, "-") || "<userId>";
  const sandboxWorkdirMap = {
    [SANDBOX_PROVIDER_NAME.BUBBLEWRAP]: "/workspace/runtime/sandbox/persist",
    [SANDBOX_PROVIDER_NAME.FIREJAIL]: "$HOME/runtime/sandbox/persist",
    [SANDBOX_PROVIDER_NAME.DOCKER]:
      dockerScope === "user"
        ? "/workspace/runtime/ops_workdir"
        : `/workspace/${normalizedUserId}/runtime/ops_workdir`,
  };
  const sandboxRootMap = {
    [SANDBOX_PROVIDER_NAME.BUBBLEWRAP]: "/workspace",
    [SANDBOX_PROVIDER_NAME.FIREJAIL]: "$HOME",
    [SANDBOX_PROVIDER_NAME.DOCKER]: "/workspace",
  };
  const sandboxWorkdir =
    sandboxWorkdirMap[sandboxProvider] || sandboxWorkdirMap[SANDBOX_PROVIDER_NAME.DOCKER];
  const sandboxRoot =
    sandboxRootMap[sandboxProvider] || sandboxRootMap[SANDBOX_PROVIDER_NAME.DOCKER];
  const extraMountRoots =
    sandboxProvider === SANDBOX_PROVIDER_NAME.DOCKER
      ? Array.from(
          new Set(
            normalizeDockerMounts(dockerConfig)
              .map((item) => String(item?.target || "").trim())
              .filter(Boolean)
              .filter((target) => target !== sandboxRoot),
          ),
        )
      : [];
  const allowedRoots = Array.from(new Set([sandboxRoot, ...extraMountRoots]));

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
