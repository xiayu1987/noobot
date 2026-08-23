/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import {
  isAbsolutePathAnyPlatform,
  resolvePathRef,
  TOOL_PATH_CONTRACTS,
} from "@noobot/path-resolver";
import { DynamicStructuredTool } from "@langchain/core/tools";
import { z } from "zod";
import { FILE_MUTATION_PROTOCOL, FILE_MUTATION_VERSION } from "@noobot/file-mutation-protocol";
import { recoverableToolError } from "../../shared/errors/index.js";
import { ERROR_CODE } from "../../shared/errors/constants.js";
import { projectToolPathRef } from "../core/check-tool-input.js";
import { toToolJsonResult } from "../core/tool-json-result.js";
import { registerResource } from "../core/resource-broker.js";
import { tTool } from "../core/tool-i18n.js";
import { TOOL_NAME } from "../constants/index.js";
import { applyFileMutation, rollbackFileMutation } from "./file-mutation-service.js";
import {
  applySearchHunks,
  applyUnifiedHunks,
  parseApplyPatch,
  parseUnifiedDiff,
  resolvePatchTargetsWithOptions,
} from "./file-patch.js";
import {
  buildFileToolDescription,
  buildLineNumberedNearbyContent,
  buildPatchFieldDescription,
  mutationLogicalPath,
  resolveRuntimeFileMutationRoot,
} from "./file-tool-shared.js";
import { confirmToolOperation, createRiskLevelSchema } from "./tool-risk.js";
import {
  SECURITY_EVIDENCE_SOURCE,
  classifyResourceRisk,
} from "@noobot/security-assessment-protocol";

function buildPatchFailurePayload({ error, original = "", pathRef = null } = {}) {
  const details = error?.details && typeof error.details === "object" ? error.details : {};
  const line = Number(details?.line || 1);
  return {
    ok: false,
    code: String(error?.code || ERROR_CODE.RECOVERABLE_INVALID_INPUT),
    error: error?.message || String(error),
    message: error?.message || String(error),
    ...(pathRef ? { path: projectToolPathRef(pathRef) } : {}),
    details,
    ...buildLineNumberedNearbyContent(original, line, 3),
  };
}

function resolvePatchProtocol({ format = "", patch = "", strip = 1 } = {}) {
  const requestedFormat = String(format || "").trim();
  const trimmedPatch = String(patch || "").trimStart();
  const detectedFormat = trimmedPatch.startsWith("*** Begin Patch")
    ? "apply_patch"
    : "unified_diff";
  if (requestedFormat && requestedFormat !== detectedFormat) {
    throw recoverableToolError(`patch format does not match content: expected ${detectedFormat}`, {
      code: ERROR_CODE.RECOVERABLE_INVALID_INPUT,
      details: { field: "format", requestedFormat, detectedFormat },
    });
  }
  return { format: requestedFormat || detectedFormat, strip };
}

async function preparePatchExecution({
  format = "",
  patch = "",
  strip = 1,
  root = "",
  agentContext = {},
} = {}) {
  const protocol = resolvePatchProtocol({ format, patch, strip });
  const parsed =
    protocol.format === "apply_patch"
      ? parseApplyPatch(patch)
      : parseUnifiedDiff(patch, protocol.strip);
  const normalizedRoot = String(root || "").trim();
  const targets = await resolvePatchTargetsWithOptions({
    patches: parsed,
    agentContext,
    root: normalizedRoot,
  });
  return { ...protocol, root: normalizedRoot, parsed, targets };
}

function buildPatchSchema(agentContext) {
  return z.object({
    format: z
      .enum(["unified_diff", "apply_patch"])
      .optional()
      .describe(tTool(agentContext, "tools.patch_file.fieldFormat")),
    patch: z.string().describe(buildPatchFieldDescription(agentContext, "fieldPatch")),
    strip: z
      .number()
      .int()
      .optional()
      .default(1)
      .describe(tTool(agentContext, "tools.patch_file.fieldStrip")),
    root: z
      .string()
      .optional()
      .default("")
      .describe(buildPatchFieldDescription(agentContext, "fieldRoot")),
    dryRun: z
      .boolean()
      .optional()
      .default(false)
      .describe(tTool(agentContext, "tools.patch_file.fieldDryRun")),
    riskLevel: createRiskLevelSchema(agentContext, "tools.patch_file.fieldRiskLevel"),
  });
}

async function buildPatchPlans({ targets, normalizedFormat, workspaceIo }) {
  const writePlans = [];
  const deletePlans = [];
  for (const item of targets) {
    if (item.mode === "add") {
      if (await workspaceIo.exists(item.resolvedNewPath)) {
        throw recoverableToolError(`target file already exists: ${item.newPath}`, {
          code: ERROR_CODE.RECOVERABLE_INVALID_INPUT,
          details: { field: "patch", filePath: item.newPath },
        });
      }
      writePlans.push({
        filePath: item.resolvedNewPath,
        content: Object.prototype.hasOwnProperty.call(item, "content")
          ? item.content
          : applyUnifiedHunks("", item.hunks || []),
        pathRef: item.newPathRef,
      });
      continue;
    }
    if (item.mode === "delete") {
      deletePlans.push({ filePath: item.resolvedOldPath, pathRef: item.oldPathRef });
      continue;
    }
    const original = await workspaceIo.readText(item.resolvedOldPath);
    let nextContent = "";
    try {
      nextContent =
        normalizedFormat === "unified_diff" && !(item.hunks || []).some((hunk) => hunk?.searchOnly)
          ? applyUnifiedHunks(original, item.hunks || [])
          : applySearchHunks(original, item.hunks || []);
    } catch (error) {
      return {
        failure: toToolJsonResult(
          TOOL_NAME.PATCH_FILE,
          buildPatchFailurePayload({ error, original, pathRef: item.oldPathRef }),
        ),
      };
    }
    const outputPath = item.resolvedNewPath || item.resolvedOldPath;
    writePlans.push({
      filePath: outputPath,
      content: nextContent,
      displayPath: item.newPath || item.oldPath,
      pathRef: item.newPathRef || item.oldPathRef,
    });
    if (item.mode === "move" && item.resolvedOldPath !== outputPath) {
      deletePlans.push({ filePath: item.resolvedOldPath, pathRef: item.oldPathRef });
    }
  }
  return { writePlans, deletePlans };
}

async function applyPatchMutations({
  writePlans,
  deletePlans,
  runtime,
  workspaceIo,
  mutationScopeId,
}) {
  const mutations = [];
  const mutationByPath = new Map();
  const rollbackStateByMutationId = new Map();
  const mutationRoot = resolveRuntimeFileMutationRoot(runtime);
  try {
    for (const plan of writePlans) {
      const rollbackState = {};
      const mutation = await applyFileMutation({
        filePath: plan.filePath,
        logicalPath: mutationLogicalPath(plan.pathRef),
        content: plan.content,
        operation: "update",
        scopeId: mutationScopeId,
        mutationRoot,
        sessionScope: runtime?.systemRuntime?.persistenceScope || null,
        rollbackState,
        writeText: (target, value) => workspaceIo.writeText(target, value),
        removeFile: (target) => workspaceIo.remove(target),
      });
      mutations.push(mutation);
      mutationByPath.set(plan.filePath, mutation);
      rollbackStateByMutationId.set(mutation.mutations[0].id, rollbackState);
    }
    for (const plan of deletePlans) {
      if (writePlans.some((item) => item.filePath === plan.filePath)) continue;
      const rollbackState = {};
      const mutation = await applyFileMutation({
        filePath: plan.filePath,
        logicalPath: mutationLogicalPath(plan.pathRef),
        operation: "delete",
        mutationRoot,
        sessionScope: runtime?.systemRuntime?.persistenceScope || null,
        rollbackState,
        writeText: (target, value) => workspaceIo.writeText(target, value),
        removeFile: (target) => workspaceIo.remove(target),
      });
      mutations.push(mutation);
      mutationByPath.set(plan.filePath, mutation);
      rollbackStateByMutationId.set(mutation.mutations[0].id, rollbackState);
    }
  } catch (error) {
    for (const mutation of mutations.toReversed()) {
      const plan = [...writePlans, ...deletePlans].find(
        (item) =>
          mutationByPath.get(item.filePath)?.mutations?.[0]?.id === mutation.mutations[0]?.id,
      );
      if (!plan) continue;
      await rollbackFileMutation({
        mutationRoot,
        mutationId: mutation.mutations[0].id,
        restoreState: rollbackStateByMutationId.get(mutation.mutations[0].id),
        filePath: plan.filePath,
        writeText: (target, value) => workspaceIo.writeText(target, value),
        removeFile: (target) => workspaceIo.remove(target),
      });
    }
    throw error;
  }
  return { mutations, mutationByPath };
}

async function registerPatchResources({ agentContext, writePlans, dryRun }) {
  if (dryRun) return [];
  return Promise.all(
    writePlans.map((item) =>
      registerResource({
        agentContext,
        executionPath: item.filePath,
        logicalPathRef: item.pathRef,
        capabilities: { read: true, write: true, scriptInput: true },
      }),
    ),
  );
}

function buildPatchResult({
  normalizedFormat,
  resolvedStrip,
  dryRun,
  resolvedRoot,
  runtime,
  writePlans,
  deletePlans,
  mutationByPath,
  mutations,
  resources,
}) {
  return toToolJsonResult(TOOL_NAME.PATCH_FILE, {
    ok: true,
    protocol: FILE_MUTATION_PROTOCOL,
    version: FILE_MUTATION_VERSION,
    format: normalizedFormat,
    strip: normalizedFormat === "unified_diff" ? resolvedStrip : undefined,
    dryRun: dryRun === true,
    root: projectToolPathRef(
      resolvePathRef({ input: resolvedRoot, workspaceRoot: runtime?.basePath || "" }),
    ),
    changes: [
      ...writePlans.map((item) => ({
        path: projectToolPathRef(item.pathRef),
        action: "write",
        mutation: mutationByPath.get(item.filePath)?.mutations?.[0] || null,
      })),
      ...deletePlans.map((item) => ({
        path: projectToolPathRef(item.pathRef),
        action: "delete",
        mutation: mutationByPath.get(item.filePath)?.mutations?.[0] || null,
      })),
    ],
    mutations: mutations.flatMap((item) => item.mutations || []),
    resources,
  });
}

async function runPatchFile({ agentContext, runtime, workspaceIo, mutationScopeId, args }) {
  const { format, patch = "", strip = 1, root = "", dryRun = false, riskLevel } = args;
  const prepared = await preparePatchExecution({ format, patch, strip, root, agentContext });
  const patchPathRefs = prepared.targets
    .flatMap((item) => [item.oldPathRef, item.newPathRef])
    .filter(Boolean)
    .map((item) => resolvePathRef({ input: item, workspaceRoot: runtime?.basePath || "" }));
  const pathView = patchPathRefs.some((item) => item.view === "host") ? "host" : "workspace";
  await confirmToolOperation({
    runtime,
    declaredRiskLevel: riskLevel,
    serverEvidence: {
      source: SECURITY_EVIDENCE_SOURCE.NORMALIZED_RESOURCE,
      riskLevel: dryRun
        ? classifyResourceRisk({ operation: "read", scope: pathView })
        : classifyResourceRisk({ operation: "patch", scope: pathView }),
    },
    toolName: TOOL_NAME.PATCH_FILE,
    operation: dryRun ? "validate file patch" : "apply file patch",
    target: prepared.targets
      .map((item) => item.newPath || item.oldPath)
      .filter(Boolean)
      .join(", "),
    reason: "The final normalized resources require confirmation under the server path policy.",
  });
  const normalizedFormat = prepared.format;
  const stripAppliesToTargets = prepared.targets.some((item) =>
    [item.oldPath, item.newPath]
      .map((value) => String(value || ""))
      .filter((value) => value && value !== "/dev/null")
      .some((value) => !isAbsolutePathAnyPlatform(value)),
  );
  const plans = await buildPatchPlans({
    targets: prepared.targets,
    normalizedFormat,
    workspaceIo,
  });
  if (plans.failure) return plans.failure;
  const mutations = dryRun
    ? { mutations: [], mutationByPath: new Map() }
    : await applyPatchMutations({
        ...plans,
        runtime,
        workspaceIo,
        mutationScopeId,
      });
  const resources = await registerPatchResources({
    agentContext,
    writePlans: plans.writePlans,
    dryRun,
  });
  return buildPatchResult({
    normalizedFormat,
    resolvedStrip: stripAppliesToTargets ? prepared.strip : null,
    dryRun,
    resolvedRoot: prepared.root,
    runtime,
    ...plans,
    ...mutations,
    resources,
  });
}

export function createPatchFileTool({ agentContext, runtime, workspaceIo, mutationScopeId }) {
  return new DynamicStructuredTool({
    name: TOOL_NAME.PATCH_FILE,
    metadata: { pathContract: TOOL_PATH_CONTRACTS.filePatch },
    description: buildFileToolDescription(agentContext, "tools.patch_file.description"),
    schema: buildPatchSchema(agentContext),
    func: (args) => runPatchFile({ agentContext, runtime, workspaceIo, mutationScopeId, args }),
  });
}
