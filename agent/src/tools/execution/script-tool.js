/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { mkdir } from "node:fs/promises";
import {
  filePath as path,
  resolveRuntimePathContext,
  TOOL_PATH_CONTRACTS,
} from "@noobot/path-resolver";
import { DynamicStructuredTool } from "@langchain/core/tools";
import { z } from "zod";
import {
  BUILTIN_THRESHOLDS,
  TOOL_EXECUTION_VIEW,
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
  ENV_DOCKER_LOCK_WAIT_TIMEOUT_MS,
  SANDBOX_COMMAND,
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

export { buildExecutionWorkspaceMeta, buildScriptExecutionMeta };

export function createScriptTool({ agentContext }) {
  const runtime = getRuntimeFromAgentContext(agentContext);
  const basePath = getBasePathFromAgentContext(agentContext);
  const globalConfig = runtime.globalConfig || {};
  if (!basePath) return [];

  const workspace = basePath;
  const userRoot = basePath;
  const userId = String(runtime?.userId || "").trim();
  const executionPolicy = resolveToolExecutionPolicy({
    toolName: EXECUTE_SCRIPT_TOOL_NAME,
    globalConfig,
  });
  const executionAuthorization = resolveToolExecutionAuthorization({
    policy: executionPolicy,
    isSuperAdmin: isSuperUserAgentContext(agentContext),
  });
  if (!executionAuthorization.allowed) return [];
  const sandboxEnabled = executionPolicy.view === TOOL_EXECUTION_VIEW.WORKSPACE_SANDBOX;
  const sandboxConfig = executionPolicy.isolation.sandbox;
  const sandboxProvider = sandboxConfig.provider;
  const lockWaitTimeoutMs = sandboxConfig.lockWaitTimeoutMs || ENV_DOCKER_LOCK_WAIT_TIMEOUT_MS;
  const pathContext = resolveRuntimePathContext({
    runtime,
    agentContext,
    runtimeBasePath: basePath,
    workspaceRoot: globalConfig?.workspaceRoot || "",
    userId,
    globalConfig,
    executionPolicy,
  });
  const description = buildScriptToolDescription({
    runtime,
    sandboxEnabled,
    sandboxProvider,
    workspace,
    pathContext,
    executionView: executionPolicy.view,
  });

  const execute_script = new DynamicStructuredTool({
    name: EXECUTE_SCRIPT_TOOL_NAME,
    metadata: { pathContract: TOOL_PATH_CONTRACTS.scriptInput },
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
    }),
    func: async (
      {
        command,
        riskLevel,
        executionMode = SCRIPT_EXECUTION_MODE.FOREGROUND,
        includeLineNumbers = false,
      },
      _runManager,
      toolConfig = {},
    ) => {
      await mkdir(workspace, { recursive: true });
      const normalizedCommand = String(command || "");
      const requestedExecutionMode = normalizeExecutionMode(executionMode);
      const shouldIncludeLineNumbers = includeLineNumbers === true;
      const timeout = BUILTIN_THRESHOLDS.executeScript.scriptTimeoutMs;
      const abortSignal = toolConfig?.signal || null;
      const identity = toolConfig?.configurable?.transferIdentity;
      if (!identity || typeof identity !== "object") {
        throw new Error("semantic_transfer_script_identity_required");
      }

      await confirmToolOperation({
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

      if (!sandboxEnabled) {
        const runResult =
          requestedExecutionMode === SCRIPT_EXECUTION_MODE.BACKGROUND
            ? await runFileBacked(normalizedCommand, workspace, timeout, abortSignal)
            : await run(normalizedCommand, workspace, timeout, abortSignal);
        if (requestedExecutionMode === SCRIPT_EXECUTION_MODE.BACKGROUND) {
          return toolFileBackedExecResult(
            "local",
            runResult,
            buildScriptExecutionMeta({
              executionPolicy,
              workspace,
              runtime,
              agentContext,
              pathContext,
            }),
            { runtime, agentContext, basePath, identity },
          );
        }
        return toolExecResult(
          "local",
          runResult,
          buildScriptExecutionMeta({
            executionPolicy,
            workspace,
            runtime,
            agentContext,
            pathContext,
          }),
          {
            includeLineNumbers: shouldIncludeLineNumbers,
            runtime,
            agentContext,
            basePath,
            identity,
          },
        );
      }

      const mode = SANDBOX_PROVIDER_NAME.DOCKER;
      let extra = buildScriptExecutionMeta({
        executionPolicy,
        workspace,
        runtime,
        agentContext,
        pathContext,
      });
      const dockerInstalled = await hasCommand(SANDBOX_COMMAND.DOCKER);
      if (!dockerInstalled) {
        throw missingCommandError(SANDBOX_PROVIDER_NAME.DOCKER, SANDBOX_COMMAND.DOCKER, runtime);
      }
      const { result: runResult, docker: built } = await runDockerCommand({
        userRoot,
        userId,
        command: normalizedCommand,
        workspace,
        timeout,
        isolation: executionPolicy.isolation,
        workdir: pathContext.currentDirectory,
        lockWaitTimeoutMs,
        abortSignal,
        runner: requestedExecutionMode === SCRIPT_EXECUTION_MODE.BACKGROUND ? runFileBacked : run,
      });
      extra = {
        ...extra,
        ...buildScriptExecutionMeta({
          executionPolicy,
          docker: built,
          workspace,
          runtime,
          agentContext,
          pathContext,
        }),
      };
      if (requestedExecutionMode === SCRIPT_EXECUTION_MODE.BACKGROUND) {
        return toolFileBackedExecResult(mode, runResult, extra, {
          runtime,
          agentContext,
          basePath,
          identity,
        });
      }
      return toolExecResult(mode, runResult, extra, {
        includeLineNumbers: shouldIncludeLineNumbers,
        runtime,
        agentContext,
        basePath,
        identity,
      });
    },
  });

  return [execute_script];
}
