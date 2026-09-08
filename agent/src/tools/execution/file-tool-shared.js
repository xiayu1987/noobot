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
import { formatLinesWithNumbers, splitLines, toPositiveInt } from "./file-utils.js";
import { tTool } from "../core/tool-i18n.js";

export function buildLineNumberedNearbyContent(content = "", targetLine = 1, radius = 3) {
  const rawContent = String(content || "");
  const lines = splitLines(rawContent);
  if (rawContent.endsWith("\n")) lines.pop();
  const totalLines = lines.length;
  if (!totalLines) {
    return { contextStartLine: 1, contextEndLine: 0, nearbyContent: "" };
  }
  const line = toPositiveInt(targetLine, 1, 1, totalLines);
  const contextRadius = toPositiveInt(radius, 3, 0, 20);
  const start = Math.max(1, line - contextRadius);
  const end = Math.min(totalLines, line + contextRadius);
  return {
    contextStartLine: start,
    contextEndLine: end,
    nearbyContent: formatLinesWithNumbers(lines.slice(start - 1, end), start),
  };
}

export function resourceFileName(resource) {
  return path.basename(String(resource?.logical?.path || "").trim());
}

export function mutationLogicalPath(pathRef) {
  const projected = projectToolPathRef(pathRef);
  if (!["workspace", "host"].includes(projected.view) || !projected.path) {
    throw new TypeError("file mutation requires a projected file path");
  }
  return projected.path;
}

export function resolveRuntimeFileMutationRoot(runtime = {}) {
  return resolveFileMutationRoot(runtime?.systemRuntime?.sessionDir);
}

export function resolveFileResourceRiskScope({ pathRef, resourcePath, runtime } = {}) {
  if (pathRef?.view === PATH_REF_VIEWS.WORKSPACE) return RESOURCE_SCOPE.WORKSPACE;
  if (pathRef?.view === PATH_REF_VIEWS.ATTACHMENT) return RESOURCE_SCOPE.ATTACHMENT;
  if (pathRef?.view !== PATH_REF_VIEWS.HOST) {
    throw new TypeError(`unsupported file resource view: ${pathRef?.view || "<empty>"}`);
  }
  if (!resourcePath) throw new TypeError("host file resource requires its canonical resource path");
  return isTrustedDirectoryPath(resourcePath, resolveConfiguredPathPolicy(runtime?.globalConfig))
    ? RESOURCE_SCOPE.TRUSTED_HOST
    : RESOURCE_SCOPE.HOST;
}

export function buildFileToolDescription(agentContext = {}, descriptionKey = "") {
  const runtime = agentContext?.bindings?.runtime || {};
  const resolution = resolveConfiguredPathPolicy(runtime.globalConfig).resolution;
  return [
    tTool(agentContext, descriptionKey),
    tTool(agentContext, "tools.file.workspaceRelativePathRule"),
    ...(resolution.followSymbolicLinks === true
      ? []
      : [tTool(agentContext, "tools.file.symbolicLinkRule")]),
  ]
    .map((item) => String(item || "").trim())
    .filter(Boolean)
    .join(" ");
}

export function buildPatchFieldDescription(agentContext = {}, fieldName = "") {
  const hostPathsAllowed = canUseHostPathsForWorkspaceTools(agentContext);
  const baseText = tTool(agentContext, `tools.patch_file.${fieldName}`);
  const modeText = (() => {
    if (fieldName === "fieldPatch") {
      return tTool(
        agentContext,
        hostPathsAllowed
          ? "tools.patch_file.fieldPatchPathHintSuperHost"
          : "tools.patch_file.fieldPatchPathHintHost",
      );
    }
    if (fieldName === "fieldRoot") {
      return tTool(
        agentContext,
        hostPathsAllowed
          ? "tools.patch_file.fieldRootPathHintSuperHost"
          : "tools.patch_file.fieldRootPathHintHost",
      );
    }
    return "";
  })();
  return [baseText, modeText]
    .map((item) => String(item || "").trim())
    .filter(Boolean)
    .join(" ");
}
