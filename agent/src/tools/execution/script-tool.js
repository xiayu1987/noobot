/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { mkdir } from "node:fs/promises";
import { TOOL_PATH_CONTRACTS } from "@noobot/path-resolver";
import { resolveAgentRuntimePathContext } from "../../context/runtime-path-context.js";
import { tool as structuredTool } from "@langchain/core/tools";
import { z } from "zod";
import {
  BUILTIN_THRESHOLDS,
  isSandboxExecutionView,
  resolveSandboxProviderExecutable,
  resolveToolExecutionPolicy,
} from "../../config/index.js";
import { resolveToolExecutionAuthorization } from "@noobot/execution-isolation-protocol";
import {
  getBasePathFromAgentContext,
  getRuntimeFromAgentContext,
} from "../../context/agent-context-accessor.js";
import { isSuperUserAgentContext } from "../../shared/utils/super-user.js";
import { tTool } from "../core/tool-i18n.js";
import {
  EXECUTE_SCRIPT_TOOL_NAME,
  SANDBOX_PROVIDER_NAME,
  SCRIPT_EXECUTION_MODE,
} from "./script-tool/constants.js";
import {
  classifyToolExecutionRisk,
  SECURITY_EVIDENCE_SOURCE,
} from "@noobot/security-assessment-protocol";
import { confirmToolOperation, createRiskLevelSchema } from "./tool-risk.js";
import {
  run,
  runFileBacked,
  hasCommand,
  normalizeExecutionMode,
} from "./script-tool/process-exec.js";
import { missingCommandError } from "./script-tool/script-errors.js";
import { toolExecResult } from "./script-tool/result-format.js";
import {
  buildExecutionWorkspaceMeta,
  buildScriptExecutionMeta,
  toolFileBackedExecResult,
} from "./script-tool/workspace-meta.js";
import { runDockerCommand } from "./script-tool/docker-runner.js";
import { buildScriptToolDescription } from "./script-tool/description.js";
import { text, isObjectLike } from "@noobot/shared/value";
import {
  assertScriptOutputFilesAuthorized,
  persistScriptOutputFiles,
} from "./script-tool/output-files.js";

export { buildExecutionWorkspaceMeta, buildScriptExecutionMeta };

export function createScriptTool({ agentContext }) {
  const runtime = getRuntimeFromAgentContext(agentContext);
  const basePath = getBasePathFromAgentContext(agentContext);
  const { globalConfig } = runtime;

  const userId = text(runtime.systemRuntime.userId);
  const executionPolicy = resolveToolExecutionPolicy({
    toolName: EXECUTE_SCRIPT_TOOL_NAME,
    globalConfig,
  });
  const executionAuthorization = resolveToolExecutionAuthorization({
    policy: executionPolicy,
    isSuperAdmin: isSuperUserAgentContext(agentContext),
  });
  if (!executionAuthorization.allowed) return [];
  const sandboxEnabled = isSandboxExecutionView(executionPolicy.view);
  const sandboxConfig = executionPolicy.isolation.sandbox;
  const sandboxProvider = sandboxConfig.provider;
  const pathContext = resolveAgentRuntimePathContext(runtime, EXECUTE_SCRIPT_TOOL_NAME);
  const description = buildScriptToolDescription({
    runtime,
    sandboxEnabled,
    sandboxProvider,
    basePath,
    pathContext,
    executionView: executionPolicy.view,
  });

  const execute_script = structuredTool(
    async (
      {
        command,
        riskLevel,
        executionMode = SCRIPT_EXECUTION_MODE.FOREGROUND,
        includeLineNumbers = false,
        outputFiles = [],
      },
      toolConfig = {},
    ) => {
      await mkdir(basePath, { recursive: true });
      const normalizedCommand = String(command || "");
      const requestedExecutionMode = normalizeExecutionMode(executionMode);
      const shouldIncludeLineNumbers = includeLineNumbers === true;
      const timeout = BUILTIN_THRESHOLDS.executeScript.scriptTimeoutMs;
      const abortSignal = toolConfig.signal;
      const generatedDataRoot = text(runtime.systemRuntime.sessionDir);
      if (!generatedDataRoot) throw new Error("session directory is required for script output");
      const identity = toolConfig?.configurable?.transferIdentity;
      if (!isObjectLike(identity)) {
        throw new Error("semantic_transfer_script_identity_required");
      }

      await confirmToolOperation({
        agentContext,
        runtime,
        declaredRiskLevel: riskLevel,
        serverEvidence: {
          source: SECURITY_EVIDENCE_SOURCE.EXECUTION_VIEW,
          riskLevel: classifyToolExecutionRisk({
            toolName: EXECUTE_SCRIPT_TOOL_NAME,
            executionView: executionPolicy.view,
          }),
        },
        toolName: EXECUTE_SCRIPT_TOOL_NAME,
        operation: "execute script",
        reason: "The command may make destructive or security-sensitive changes.",
      });
      await assertScriptOutputFilesAuthorized({ agentContext, outputFiles });

      if (!sandboxEnabled) {
        const runResult =
          requestedExecutionMode === SCRIPT_EXECUTION_MODE.BACKGROUND
            ? await runFileBacked(normalizedCommand, basePath, timeout, abortSignal, {
                generatedDataRoot,
              })
            : await run(normalizedCommand, basePath, timeout, abortSignal, {
                generatedDataRoot,
              });
        const { transferEnvelopes: outputFileEnvelopes, outputResources } =
          await persistScriptOutputFiles({
            agentContext,
            runtime,
            identity,
            outputFiles,
          });
        if (requestedExecutionMode === SCRIPT_EXECUTION_MODE.BACKGROUND) {
          return toolFileBackedExecResult(
            "local",
            runResult,
            buildScriptExecutionMeta({ executionPolicy }),
            { runtime, identity, outputFileEnvelopes, outputResources },
          );
        }
        return toolExecResult("local", runResult, buildScriptExecutionMeta({ executionPolicy }), {
          includeLineNumbers: shouldIncludeLineNumbers,
          runtime,
          identity,
          outputFileEnvelopes,
          outputResources,
        });
      }

      const mode = SANDBOX_PROVIDER_NAME.DOCKER;
      const extra = buildScriptExecutionMeta({ executionPolicy });
      const sandboxExecutable = resolveSandboxProviderExecutable(sandboxProvider);
      const dockerInstalled = await hasCommand(sandboxExecutable);
      if (!dockerInstalled) {
        throw missingCommandError(SANDBOX_PROVIDER_NAME.DOCKER, sandboxExecutable, runtime);
      }
      const runResult = await runDockerCommand({
        basePath,
        userId,
        command: normalizedCommand,
        timeout,
        isolation: executionPolicy.isolation,
        workdir: pathContext.directories.currentDirectory,
        abortSignal,
        runnerOptions: { generatedDataRoot },
        runner: requestedExecutionMode === SCRIPT_EXECUTION_MODE.BACKGROUND ? runFileBacked : run,
      });
      const { transferEnvelopes: outputFileEnvelopes, outputResources } =
        await persistScriptOutputFiles({
          agentContext,
          runtime,
          identity,
          outputFiles,
        });
      if (requestedExecutionMode === SCRIPT_EXECUTION_MODE.BACKGROUND) {
        return toolFileBackedExecResult(mode, runResult, extra, {
          runtime,
          identity,
          outputFileEnvelopes,
          outputResources,
        });
      }
      return toolExecResult(mode, runResult, extra, {
        includeLineNumbers: shouldIncludeLineNumbers,
        runtime,
        identity,
        outputFileEnvelopes,
        outputResources,
      });
    },
    {
      name: EXECUTE_SCRIPT_TOOL_NAME,
      metadata: { pathContract: TOOL_PATH_CONTRACTS.scriptOutput },
      description,
      schema: z.object({
        command: z.string().describe(tTool(runtime, "tools.script.fieldCommand")),
        riskLevel: createRiskLevelSchema(runtime, "tools.script.fieldRiskLevel"),
        executionMode: z
          .enum([SCRIPT_EXECUTION_MODE.FOREGROUND, SCRIPT_EXECUTION_MODE.BACKGROUND])
          .optional()
          .default(SCRIPT_EXECUTION_MODE.FOREGROUND)
          .describe(tTool(runtime, "tools.script.fieldExecutionMode")),
        includeLineNumbers: z
          .boolean()
          .optional()
          .default(false)
          .describe(tTool(runtime, "tools.script.fieldIncludeLineNumbers")),
        outputFiles: z
          .array(z.string())
          .optional()
          .default([])
          .describe(tTool(runtime, "tools.script.fieldOutputFiles")),
      }),
    },
  );

  return [execute_script];
}
