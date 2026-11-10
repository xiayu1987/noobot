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
import { structuredTool } from "../core/structured-tool.js";
import { z } from "zod";
import {
  FILE_MUTATION_ERROR_CODE,
  FILE_MUTATION_PROTOCOL,
  FILE_MUTATION_VERSION,
  createFileMutationError,
  PATCH_FORMATS,
  PATCH_CONTENT_ENCODINGS,
  PATCH_SHA256_PATTERN,
  indexPatchBaseVersions,
  indexPatchOperations,
  decodePatchText,
  FILE_TEXT_ENCODING_INPUTS,
} from "@noobot/file-mutation-protocol";
import { decodeFileDocument, encodeFileText } from "@noobot/file-mutation-protocol/text-codec-node";
import { ERROR_LEVEL, recoverableToolError } from "../../shared/errors/index.js";
import { ERROR_CODE } from "../../shared/errors/constants.js";
import { projectToolPathRef } from "../core/check-tool-input.js";
import { toToolJsonResult } from "../core/tool-json-result.js";
import { registerResource } from "../core/resource-broker.js";
import { tTool } from "../core/tool-i18n.js";
import { TOOL_NAME } from "../constants/index.js";
import { applyFileMutation, rollbackFileMutation } from "./file-mutation-service.js";
import { fileContentSha256, withFileMutationLocks } from "./file-mutation-state.js";
import {
  applyPatchHunks,
  parseApplyPatch,
  parseUnifiedDiff,
  resolvePatchTargetsWithOptions,
} from "./file-patch.js";
import {
  buildFileToolDescription,
  buildLineNumberedNearbyContent,
  buildPatchFieldDescription,
  resolveFileResourceRiskScope,
  mutationLocator,
  resolveRuntimeFileMutationRoot,
} from "./file-tool-shared.js";
import { confirmToolOperation, createRiskLevelSchema } from "./tool-risk.js";
import {
  RESOURCE_OPERATION,
  SECURITY_EVIDENCE_SOURCE,
  classifyResourceSetRisk,
} from "@noobot/security-assessment-protocol";
import { text } from "@noobot/shared/value";

function buildPatchFailurePayload({ error, original, pathRef, encoding }) {
  const { details } = error;
  return {
    ok: false,
    code: error.code,
    error: error.message,
    path: projectToolPathRef(pathRef),
    details,
    ...(details.line ? buildLineNumberedNearbyContent(original, details.line, encoding) : {}),
  };
}

function resolvePatchProtocol({ format, patch, strip }) {
  const requestedFormat = text(format);
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

async function preparePatchExecution({ format, patch, strip, root, agentContext }) {
  const protocol = resolvePatchProtocol({ format, patch, strip });
  const parsed =
    protocol.format === "apply_patch"
      ? parseApplyPatch(patch)
      : parseUnifiedDiff(patch, protocol.strip);
  const normalizedRoot = text(root);
  const targets = await resolvePatchTargetsWithOptions({
    patches: parsed,
    agentContext,
    root: normalizedRoot,
  });
  return { ...protocol, root: normalizedRoot, parsed, targets };
}

function buildPatchSchema(agentContext, runtime) {
  return z.strictObject({
    encoding: z
      .enum(FILE_TEXT_ENCODING_INPUTS)
      .default("auto")
      .describe(tTool(runtime, "tools.file.fieldEncoding")),
    format: z
      .enum(PATCH_FORMATS)
      .optional()
      .describe(tTool(runtime, "tools.patch_file.fieldFormat")),
    patch: z.string().describe(buildPatchFieldDescription(agentContext, "fieldPatch")),
    contentEncoding: z
      .enum(PATCH_CONTENT_ENCODINGS)
      .default("raw")
      .describe(tTool(runtime, "tools.patch_file.fieldContentEncoding")),
    baseVersions: z
      .array(
        z.strictObject({
          filePath: z.string().min(1),
          sha256: z.string().regex(PATCH_SHA256_PATTERN).nullable(),
        }),
      )
      .describe(tTool(runtime, "tools.patch_file.fieldBaseVersions")),
    strip: z
      .number()
      .int()
      .min(0)
      .max(10)
      .optional()
      .default(0)
      .describe(tTool(runtime, "tools.patch_file.fieldStrip")),
    root: z
      .string()
      .optional()
      .default("")
      .describe(buildPatchFieldDescription(agentContext, "fieldRoot")),
    dryRun: z
      .boolean()
      .optional()
      .default(false)
      .describe(tTool(runtime, "tools.patch_file.fieldDryRun")),
    riskLevel: createRiskLevelSchema(runtime, "tools.patch_file.fieldRiskLevel"),
  });
}

function validateDeletedContent({ original, hunks, contentEncoding }) {
  if (!hunks.length) return;
  const applied = applyPatchHunks(original, hunks, contentEncoding);
  if (decodePatchText(applied.content).lines.length) {
    throw recoverableToolError("unified delete must remove the entire file", {
      code: ERROR_CODE.RECOVERABLE_INVALID_INPUT,
      details: { field: "patch" },
    });
  }
}

async function buildPatchPlans({ targets, contentEncoding, baseVersions, workspaceIo, encoding }) {
  const writePlans = [];
  const deletePlans = [];
  const initialContents = new Map();
  const contentHashes = new WeakMap();
  const readContent = async (filePath) => {
    if (initialContents.has(filePath)) return initialContents.get(filePath);
    const buffer = await workspaceIo.readBuffer(filePath).catch((error) => {
      if (error?.code === "ENOENT") return null;
      throw error;
    });
    initialContents.set(filePath, buffer);
    return buffer;
  };
  const hash = (buffer) => {
    if (buffer === null) return null;
    if (!contentHashes.has(buffer)) contentHashes.set(buffer, fileContentSha256(buffer));
    return contentHashes.get(buffer);
  };
  const paths = new Map();
  for (const item of targets) {
    if (item.oldPath) paths.set(item.oldPath, item.resolvedOldPath);
    if (item.newPath) paths.set(item.newPath, item.resolvedNewPath);
  }
  let versions;
  let operations;
  try {
    operations = indexPatchOperations(
      targets.map((item) => ({
        mode: item.mode,
        source: item.resolvedOldPath,
        destination: item.resolvedNewPath,
      })),
    );
  } catch (error) {
    if (!(error instanceof TypeError)) throw error;
    throw recoverableToolError(error.message, {
      code: ERROR_CODE.RECOVERABLE_INVALID_INPUT,
      details: { field: "patch", contract: "operations" },
    });
  }
  try {
    versions = indexPatchBaseVersions(
      baseVersions,
      [...paths].map(([filePath, identity]) => ({ filePath, identity })),
    );
  } catch (error) {
    if (!(error instanceof TypeError)) throw error;
    throw recoverableToolError(error.message, {
      code: ERROR_CODE.RECOVERABLE_INVALID_INPUT,
      details: { field: "baseVersions", contract: "baseVersions" },
    });
  }
  for (const [filePath, resolved] of paths) {
    const actualSha256 = hash(await readContent(resolved));
    const expectedSha256 = versions.get(resolved);
    if (actualSha256 !== expectedSha256) {
      throw createFileMutationError(
        FILE_MUTATION_ERROR_CODE.CONFLICT,
        `file changed since the base version was read: ${filePath}; read it again and rebuild the patch`,
        { details: { filePath, expectedSha256, actualSha256 } },
      );
    }
  }
  for (const item of targets) {
    const failure = await planTarget(item);
    if (failure) return failure;
  }
  return { writePlans, deletePlans };

  async function planTarget(item) {
    if (item.mode === "add") {
      if ((await readContent(item.resolvedNewPath)) !== null) {
        throw recoverableToolError(`target file already exists: ${item.newPath}`, {
          code: ERROR_CODE.RECOVERABLE_INVALID_INPUT,
          details: { field: "patch", filePath: item.newPath },
        });
      }
      const outputEncoding = encoding === "auto" ? "utf-8" : encoding;
      const buffer = encodeFileText(item.content, outputEncoding);
      writePlans.push({
        filePath: item.resolvedNewPath,
        content: item.content,
        encoding: outputEncoding,
        pathRef: item.newPathRef,
        expectedSha256: null,
        baseSha256: null,
        afterSha256: hash(buffer),
      });
      return;
    }
    const originalBuffer = await readContent(item.resolvedOldPath);
    if (originalBuffer === null) {
      throw recoverableToolError(`file not found: ${item.oldPath}`, {
        code: ERROR_CODE.RECOVERABLE_FILE_NOT_FOUND,
      });
    }
    const originalSha256 = hash(originalBuffer);
    const document = decodeFileDocument(originalBuffer, encoding);
    const original = document.content;
    if (item.mode === "delete") {
      validateDeletedContent({ original, hunks: item.hunks, contentEncoding });
      planRemoval(item, originalSha256);
      return;
    }
    let applied = null;
    try {
      applied = applyPatchHunks(original, item.hunks, contentEncoding);
    } catch (error) {
      if (error?.level !== ERROR_LEVEL.RECOVERABLE) throw error;
      return {
        failure: toToolJsonResult(
          TOOL_NAME.PATCH_FILE,
          buildPatchFailurePayload({
            error,
            original,
            pathRef: item.oldPathRef,
            encoding: document.encoding,
          }),
        ),
      };
    }
    const outputPath = item.resolvedNewPath;
    const outputBuffer = encodeFileText(applied.content, document.encoding);
    writePlans.push({
      filePath: outputPath,
      content: applied.content,
      encoding: document.encoding,
      pathRef: item.newPathRef,
      expectedSha256: hash(await readContent(outputPath)),
      adaptations: applied.adaptations,
      baseSha256: hash(await readContent(outputPath)),
      afterSha256: hash(outputBuffer),
    });
    planRemoval(item, originalSha256);
  }

  function planRemoval(item, originalSha256) {
    if (operations.deletes.has(item.resolvedOldPath)) {
      deletePlans.push({
        filePath: item.resolvedOldPath,
        pathRef: item.oldPathRef,
        encoding,
        expectedSha256: originalSha256,
        baseSha256: originalSha256,
      });
    }
  }
}

async function applyPatchMutations({
  writePlans,
  deletePlans,
  runtime,
  workspaceIo,
  mutationScopeId,
}) {
  const mutations = [];
  const committed = [];
  const mutationRoot = resolveRuntimeFileMutationRoot(runtime);
  const commitPlan = async (plan, operationFields) => {
    const rollbackState = {};
    const mutation = await applyFileMutation({
      filePath: plan.filePath,
      locator: mutationLocator(plan.pathRef),
      expectedSha256: plan.expectedSha256,
      mutationRoot,
      sessionScope: runtime.systemRuntime.persistenceScope,
      rollbackState,
      stageBytes: (target, value) => workspaceIo.writeBytes(target, value),
      ...operationFields,
    });
    mutations.push(mutation);
    committed.push({ mutation, plan, rollbackState });
  };
  try {
    for (const plan of writePlans) {
      await commitPlan(plan, {
        operation: "update",
        content: plan.content,
        encoding: plan.encoding,
        scopeId: mutationScopeId,
      });
    }
    for (const plan of deletePlans) {
      await commitPlan(plan, { operation: "delete", encoding: plan.encoding });
    }
  } catch (error) {
    const rollbackErrors = await rollbackPatchMutations({ committed, mutationRoot });
    if (rollbackErrors.length) {
      throw createFileMutationError(
        FILE_MUTATION_ERROR_CODE.ROLLBACK_CONFLICT,
        `patch failed and some files could not be rolled back; read the affected files before retrying: ${error.message}`,
        { cause: error, details: { ...error.details, rollbackErrors } },
      );
    }
    throw error;
  }
  return mutations.flatMap((item) => item.mutations);
}

async function rollbackPatchMutations({ committed, mutationRoot }) {
  const rollbackErrors = [];
  for (const { mutation, plan, rollbackState } of committed.toReversed()) {
    try {
      await rollbackFileMutation({
        mutationRoot,
        mutationId: mutation.mutations[0].id,
        restoreState: rollbackState,
        filePath: plan.filePath,
      });
    } catch (rollbackError) {
      rollbackErrors.push({
        path: mutationLocator(plan.pathRef).path,
        error: rollbackError.message,
      });
    }
  }
  return rollbackErrors;
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
  mutations,
  outputResources,
}) {
  return toToolJsonResult(TOOL_NAME.PATCH_FILE, {
    ok: true,
    protocol: FILE_MUTATION_PROTOCOL,
    version: FILE_MUTATION_VERSION,
    format: normalizedFormat,
    strip: normalizedFormat === "unified_diff" ? resolvedStrip : undefined,
    dryRun: dryRun === true,
    root: projectToolPathRef(
      resolvePathRef({ input: resolvedRoot, workspaceRoot: runtime.basePath }),
    ),
    changes: [
      ...writePlans.map((item) => ({
        path: projectToolPathRef(item.pathRef),
        action: "write",
        baseSha256: item.baseSha256,
        afterSha256: item.afterSha256,
        encoding: item.encoding,
        ...(item.adaptations?.length ? { adaptations: item.adaptations } : {}),
      })),
      ...deletePlans.map((item) => ({
        path: projectToolPathRef(item.pathRef),
        action: "delete",
        baseSha256: item.baseSha256,
        afterSha256: null,
      })),
    ],
    mutations,
    outputResources,
  });
}

async function runPatchFile({ agentContext, runtime, workspaceIo, mutationScopeId, args }) {
  const { format, patch, strip, root, dryRun, riskLevel, contentEncoding, baseVersions } = args;
  const prepared = await preparePatchExecution({ format, patch, strip, root, agentContext });
  const patchResources = prepared.targets
    .flatMap((item) => [
      { pathRef: item.oldPathRef, resourcePath: item.oldResourcePath },
      { pathRef: item.newPathRef, resourcePath: item.newResourcePath },
    ])
    .filter((item) => item.pathRef && item.resourcePath);
  const resourceScopes = patchResources.map((item) =>
    resolveFileResourceRiskScope({
      pathRef: item.pathRef,
      resourcePath: item.resourcePath,
      runtime,
    }),
  );
  await confirmToolOperation({
    agentContext,
    runtime,
    declaredRiskLevel: riskLevel,
    serverEvidence: {
      source: SECURITY_EVIDENCE_SOURCE.NORMALIZED_RESOURCE,
      riskLevel: classifyResourceSetRisk({
        operation: dryRun ? RESOURCE_OPERATION.READ : RESOURCE_OPERATION.PATCH,
        scopes: resourceScopes,
      }),
    },
    toolName: TOOL_NAME.PATCH_FILE,
    operation: dryRun ? "validate file patch" : "apply file patch",
    target: prepared.targets.map((item) => item.targetPath).join(", "),
    reason: "The final normalized resources require confirmation under the server path policy.",
  });
  const normalizedFormat = prepared.format;
  const stripAppliesToTargets = prepared.targets.some((item) =>
    [item.oldPath, item.newPath].filter(Boolean).some((value) => !isAbsolutePathAnyPlatform(value)),
  );
  const { plans, mutations } = await withFileMutationLocks(
    prepared.targets
      .flatMap((item) => [item.resolvedOldPath, item.resolvedNewPath])
      .filter(Boolean),
    async () => {
      const plans = await buildPatchPlans({
        targets: prepared.targets,
        contentEncoding,
        baseVersions,
        workspaceIo,
        encoding: args.encoding,
      });
      if (plans.failure) return { plans };
      const mutations = dryRun
        ? []
        : await applyPatchMutations({
            ...plans,
            runtime,
            workspaceIo,
            mutationScopeId,
          });
      return { plans, mutations };
    },
  );
  if (plans.failure) return plans.failure;
  const outputResources = await registerPatchResources({
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
    mutations,
    outputResources,
  });
}

export function createPatchFileTool({ agentContext, runtime, workspaceIo, mutationScopeId }) {
  return structuredTool(
    runtime,
    (args) => runPatchFile({ agentContext, runtime, workspaceIo, mutationScopeId, args }),
    {
      name: TOOL_NAME.PATCH_FILE,
      metadata: { pathContract: TOOL_PATH_CONTRACTS.filePatch },
      description: buildFileToolDescription(runtime, "tools.patch_file.description"),
      schema: buildPatchSchema(agentContext, runtime),
    },
    agentContext,
  );
}
