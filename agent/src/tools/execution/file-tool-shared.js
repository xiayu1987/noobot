/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { filePath as path, isTrustedDirectoryPath, PATH_REF_VIEWS } from "@noobot/path-resolver";
import { RESOURCE_SCOPE } from "@noobot/security-assessment-protocol";
import { canUseHostPathsForWorkspaceTools, projectToolPathRef } from "../core/check-tool-input.js";
import { resolveConfiguredPathPolicy } from "../../config/core/path-policy-adapter.js";
import { resolveFileMutationRoot } from "./file-mutation-service.js";
import { formatLinesWithNumbers, PATCH_FAILURE_CONTEXT_RADIUS, splitLines } from "./file-utils.js";
import { tTool } from "../core/tool-i18n.js";
import { getRuntimeFromAgentContext } from "../../context/agent-context-accessor.js";
import { createFileMutationLocator } from "@noobot/file-mutation-protocol";
import { text } from "@noobot/shared/value";

export function buildLineNumberedNearbyContent(content, targetLine) {
  const lines = splitLines(content);
  if (content.endsWith("\n")) lines.pop();
  const totalLines = lines.length;
  const start = Math.max(1, targetLine - PATCH_FAILURE_CONTEXT_RADIUS);
  const end = Math.min(totalLines, targetLine + PATCH_FAILURE_CONTEXT_RADIUS);
  if (start > end) return { totalLines };
  return {
    totalLines,
    contextStartLine: start,
    contextEndLine: end,
    nearbyContent: formatLinesWithNumbers(lines.slice(start - 1, end), start),
  };
}

export function resourceFileName(resource) {
  return path.basename(text(resource?.logical?.path));
}

export function mutationLocator(pathRef) {
  return createFileMutationLocator(projectToolPathRef(pathRef));
}

export function resolveRuntimeFileMutationRoot(runtime) {
  return resolveFileMutationRoot(runtime.systemRuntime.sessionDir);
}

export function resolveFileResourceRiskScope({ pathRef, resourcePath, runtime } = {}) {
  if (pathRef?.view === PATH_REF_VIEWS.WORKSPACE) return RESOURCE_SCOPE.WORKSPACE;
  if (pathRef?.view === PATH_REF_VIEWS.MOUNT) return RESOURCE_SCOPE.MOUNT;
  if (pathRef?.view === PATH_REF_VIEWS.ATTACHMENT) return RESOURCE_SCOPE.ATTACHMENT;
  if (pathRef?.view !== PATH_REF_VIEWS.HOST) {
    throw new TypeError(`unsupported file resource view: ${pathRef?.view || "<empty>"}`);
  }
  if (!resourcePath) throw new TypeError("host file resource requires its canonical resource path");
  return isTrustedDirectoryPath(resourcePath, resolveConfiguredPathPolicy(runtime?.globalConfig))
    ? RESOURCE_SCOPE.TRUSTED_HOST
    : RESOURCE_SCOPE.HOST;
}

export function buildFileToolDescription(runtime = {}, descriptionKey = "") {
  const resolution = resolveConfiguredPathPolicy(runtime.globalConfig).resolution;
  return [
    tTool(runtime, descriptionKey),
    tTool(runtime, "tools.file.workspaceRelativePathRule"),
    ...(resolution.followSymbolicLinks === true
      ? []
      : [tTool(runtime, "tools.file.symbolicLinkRule")]),
  ]
    .map((item) => text(item))
    .filter(Boolean)
    .join(" ");
}

export function buildPatchFieldDescription(agentContext = {}, fieldName = "") {
  const runtime = getRuntimeFromAgentContext(agentContext);
  const hostPathsAllowed = canUseHostPathsForWorkspaceTools(agentContext);
  const baseText = tTool(runtime, `tools.patch_file.${fieldName}`);
  const modeText = (() => {
    if (fieldName === "fieldPatch") {
      return tTool(
        runtime,
        hostPathsAllowed
          ? "tools.patch_file.fieldPatchPathHintSuperHost"
          : "tools.patch_file.fieldPatchPathHintHost",
      );
    }
    if (fieldName === "fieldRoot") {
      return tTool(
        runtime,
        hostPathsAllowed
          ? "tools.patch_file.fieldRootPathHintSuperHost"
          : "tools.patch_file.fieldRootPathHintHost",
      );
    }
    return "";
  })();
  return [baseText, modeText]
    .map((item) => text(item))
    .filter(Boolean)
    .join(" ");
}
