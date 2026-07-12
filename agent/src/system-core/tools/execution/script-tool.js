/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { mkdir } from "node:fs/promises";
import {
  filePath as path,
  resolveRuntimePathContext,
} from "../../utils/path-resolver.js";
import { DynamicStructuredTool } from "@langchain/core/tools";
import { z } from "zod";
import { BUILTIN_THRESHOLDS, mergeConfig } from "../../config/index.js";
import { getRuntimeFromAgentContext } from "../../context/agent-context-accessor.js";
import { ERROR_CODE } from "../../error/constants.js";
import {
  buildBubblewrapCommand,
  bwrapSupportsOption,
  ensureBubblewrapOverlayReady,
} from "../../sandbox/bubblewrap-sandbox.js";
import { buildFirejailCommand } from "../../sandbox/firejail-sandbox.js";
import { tTool } from "../core/tool-i18n.js";
import {
  EXECUTE_SCRIPT_TOOL_NAME,
  SANDBOX_COMMAND,
  SANDBOX_PROVIDER_NAME,
  SCRIPT_EXECUTION_MODE,
} from "./script-tool/constants.js";
import { run, runFileBacked, hasCommand, normalizeExecutionMode } from "./script-tool/process-exec.js";
import {
  resolveSandboxProviderConfig,
  resolveDockerScriptConfig,
} from "./script-tool/sandbox-config.js";
import { tScript } from "./script-tool/script-i18n.js";
import { missingCommandError, scriptRuntimeError } from "./script-tool/script-errors.js";
import { toolExecResult } from "./script-tool/result-format.js";
import {
  buildExecutionWorkspaceMeta,
  buildScriptExecutionMeta,
  toolFileBackedExecResult,
} from "./script-tool/workspace-meta.js";
import { runDockerCommand, tryDockerFallback } from "./script-tool/docker-runner.js";
import { buildScriptToolDescription } from "./script-tool/description.js";

export { buildExecutionWorkspaceMeta, buildScriptExecutionMeta };

export function createScriptTool({ agentContext }) {
  const runtime = getRuntimeFromAgentContext(agentContext);
  const basePath =
    agentContext?.environment?.workspace?.basePath || runtime.basePath || "";
  const globalConfig = runtime.globalConfig || {};
  const effectiveConfig = mergeConfig(globalConfig, runtime.userConfig || {});
  if (!basePath) return [];

  const workspace = path.join(basePath, "runtime/ops_workdir");
  const userRoot = basePath;
  const userId = String(runtime?.userId || "").trim();
  const scriptConfig =
    effectiveConfig?.tools?.[EXECUTE_SCRIPT_TOOL_NAME] &&
    typeof effectiveConfig.tools[EXECUTE_SCRIPT_TOOL_NAME] === "object" &&
    !Array.isArray(effectiveConfig.tools[EXECUTE_SCRIPT_TOOL_NAME])
      ? effectiveConfig.tools[EXECUTE_SCRIPT_TOOL_NAME]
      : {};
  const sandboxEnabled = scriptConfig?.sandboxMode === true || scriptConfig?.sandbox_mode === true;
  const { provider: sandboxProvider, providerDetail } =
    resolveSandboxProviderConfig(scriptConfig);
  const dockerConfig = resolveDockerScriptConfig(scriptConfig, providerDetail);
  const pathContext = resolveRuntimePathContext({
    runtime,
    agentContext,
    runtimeBasePath: basePath,
    workspaceRoot: globalConfig?.workspaceRoot || "",
    userId,
    globalConfig,
    effectiveConfig,
  });
  const description = buildScriptToolDescription({
    runtime,
    sandboxEnabled,
    sandboxProvider,
    workspace,
    pathContext,
  });

  const execute_script = new DynamicStructuredTool({
    name: EXECUTE_SCRIPT_TOOL_NAME,
    description,
    schema: z.object({
      command: z.string().describe(tTool(runtime, "tools.script.fieldCommand")),
      executionMode: z.enum([SCRIPT_EXECUTION_MODE.FOREGROUND, SCRIPT_EXECUTION_MODE.BACKGROUND])
        .optional()
        .default(SCRIPT_EXECUTION_MODE.FOREGROUND)
        .describe(tTool(runtime, "tools.script.fieldExecutionMode")),
      includeLineNumbers: z.boolean().optional().default(false).describe(tTool(runtime, "tools.script.fieldIncludeLineNumbers")),
    }),
    func: async ({ command, executionMode = SCRIPT_EXECUTION_MODE.FOREGROUND, includeLineNumbers = false }) => {
      await mkdir(workspace, { recursive: true });
      const normalizedCommand = String(command || "");
      const requestedExecutionMode = normalizeExecutionMode(executionMode);
      const shouldIncludeLineNumbers = includeLineNumbers === true;
      const timeout = BUILTIN_THRESHOLDS.executeScript.scriptTimeoutMs;

      if (!sandboxEnabled) {
        const runResult = requestedExecutionMode === SCRIPT_EXECUTION_MODE.BACKGROUND
          ? await runFileBacked(normalizedCommand, workspace, timeout)
          : await run(normalizedCommand, workspace, timeout);
        if (requestedExecutionMode === SCRIPT_EXECUTION_MODE.BACKGROUND) {
          return toolFileBackedExecResult(
            "local",
            runResult,
            buildScriptExecutionMeta({
              sandboxEnabled: false,
              workspace,
              runtime,
              agentContext,
              pathContext,
            }),
            { runtime, agentContext, basePath },
          );
        }
        return toolExecResult(
          "local",
          runResult,
          buildScriptExecutionMeta({
            sandboxEnabled: false,
            workspace,
            runtime,
            agentContext,
            pathContext,
          }),
          { includeLineNumbers: shouldIncludeLineNumbers },
        );
      }

      let sandboxCmd = "";
      let mode = SANDBOX_PROVIDER_NAME.DOCKER;
      let extra = buildScriptExecutionMeta({
        sandboxEnabled: true,
        sandboxProvider,
        workspace,
        runtime,
        agentContext,
        dockerConfig,
        pathContext,
      });
      let dockerRunInput = null;

      if (sandboxProvider === SANDBOX_PROVIDER_NAME.BUBBLEWRAP) {
        const bwrapInstalled = await hasCommand(SANDBOX_COMMAND.BUBBLEWRAP);
        if (!bwrapInstalled) {
          throw missingCommandError(
            SANDBOX_PROVIDER_NAME.BUBBLEWRAP,
            SANDBOX_COMMAND.BUBBLEWRAP,
            runtime,
          );
        }

        const supportsOverlaySrc = await bwrapSupportsOption("--overlay-src");
        if (!supportsOverlaySrc) {
          const fallbackResult = await tryDockerFallback({
            userRoot,
            userId,
            command: normalizedCommand,
            workspace,
            timeout,
            scriptConfig: dockerConfig,
            runtime,
            agentContext,
            pathContext,
            fallbackFrom: SANDBOX_PROVIDER_NAME.BUBBLEWRAP,
            warning: tScript(runtime, "fallbackOverlaySrc"),
            executionMode: requestedExecutionMode,
          });
          if (fallbackResult) return fallbackResult;
          throw scriptRuntimeError(tScript(runtime, "overlaySrcUnsupported"), {
            code: ERROR_CODE.RECOVERABLE_BWRAP_OVERLAY_SRC_UNSUPPORTED,
            details: {
              mode: SANDBOX_PROVIDER_NAME.BUBBLEWRAP,
              code: 2,
            },
          });
        }

        const built = buildBubblewrapCommand({ userRoot, command: normalizedCommand });
        try {
          await ensureBubblewrapOverlayReady({
            overlayUpper: built.overlayUpper,
            overlayWork: built.overlayWork,
          });
        } catch (err) {
          throw scriptRuntimeError(
            tScript(runtime, "overlayDirNotWritable", {
              sandboxRoot: built.sandboxRoot,
              reason: err?.message || String(err),
            }),
            {
              code: ERROR_CODE.RECOVERABLE_BWRAP_OVERLAY_NOT_WRITABLE,
              details: {
                mode: SANDBOX_PROVIDER_NAME.BUBBLEWRAP,
                code: 13,
                sandboxRoot: built.sandboxRoot,
                overlayUpper: built.overlayUpper,
                overlayWork: built.overlayWork,
              },
            },
          );
        }
        sandboxCmd = built.cmd;
        mode = SANDBOX_PROVIDER_NAME.BUBBLEWRAP;
        extra = buildScriptExecutionMeta({
          sandboxEnabled: true,
          sandboxProvider: SANDBOX_PROVIDER_NAME.BUBBLEWRAP,
          workspace,
          runtime,
          agentContext,
          dockerConfig,
          pathContext,
        });
      } else if (sandboxProvider === SANDBOX_PROVIDER_NAME.FIREJAIL) {
        const firejailInstalled = await hasCommand(SANDBOX_COMMAND.FIREJAIL);
        if (!firejailInstalled) {
          throw missingCommandError(
            SANDBOX_PROVIDER_NAME.FIREJAIL,
            SANDBOX_COMMAND.FIREJAIL,
            runtime,
          );
        }

        const built = buildFirejailCommand({ userRoot, command: normalizedCommand });
        sandboxCmd = built.cmd;
        mode = SANDBOX_PROVIDER_NAME.FIREJAIL;
        extra = buildScriptExecutionMeta({
          sandboxEnabled: true,
          sandboxProvider: SANDBOX_PROVIDER_NAME.FIREJAIL,
          workspace,
          runtime,
          agentContext,
          dockerConfig,
          pathContext,
        });
      } else {
        const dockerInstalled = await hasCommand(SANDBOX_COMMAND.DOCKER);
        if (!dockerInstalled) {
          throw missingCommandError(
            SANDBOX_PROVIDER_NAME.DOCKER,
            SANDBOX_COMMAND.DOCKER,
            runtime,
          );
        }
        dockerRunInput = {
          userRoot,
          userId,
          command: normalizedCommand,
          workspace,
          timeout,
          scriptConfig: dockerConfig,
        };
      }

      let runResult = null;
      if (mode === SANDBOX_PROVIDER_NAME.DOCKER && dockerRunInput) {
        const { result: dockerResult, docker: built } = await runDockerCommand(
          {
            ...dockerRunInput,
            runner: requestedExecutionMode === SCRIPT_EXECUTION_MODE.BACKGROUND
              ? runFileBacked
              : run,
          },
        );
        runResult = dockerResult;
        extra = {
          ...extra,
          ...buildScriptExecutionMeta({
            sandboxEnabled: true,
            sandboxProvider: SANDBOX_PROVIDER_NAME.DOCKER,
            dockerConfig,
            docker: built,
            workspace,
            runtime,
            agentContext,
            pathContext,
          }),
        };
      } else {
        runResult = requestedExecutionMode === SCRIPT_EXECUTION_MODE.BACKGROUND
          ? await runFileBacked(sandboxCmd, workspace, timeout)
          : await run(sandboxCmd, workspace, timeout);
      }
      if (
        mode === SANDBOX_PROVIDER_NAME.BUBBLEWRAP &&
        Number(runResult?.code || 0) !== 0 &&
        /Can't make overlay mount|userxattr:\s*Invalid argument/i.test(
          String(runResult?.stderr || ""),
        )
      ) {
        const fallbackResult = await tryDockerFallback({
          userRoot,
          userId,
          command: normalizedCommand,
          workspace,
          timeout,
          scriptConfig: dockerConfig,
          runtime,
          agentContext,
          fallbackFrom: SANDBOX_PROVIDER_NAME.BUBBLEWRAP,
          warning: tScript(runtime, "fallbackUserxattr"),
          includeLineNumbers: shouldIncludeLineNumbers,
          executionMode: requestedExecutionMode,
        });
        if (fallbackResult) return fallbackResult;
        runResult = {
          ...runResult,
          stderr: tScript(runtime, "userxattrUnsupported", {
            stderr: String(runResult?.stderr || ""),
          }),
        };
      }
      if (requestedExecutionMode === SCRIPT_EXECUTION_MODE.BACKGROUND) {
        return toolFileBackedExecResult(mode, runResult, extra, {
          runtime,
          agentContext,
          basePath,
        });
      }
      return toolExecResult(mode, runResult, extra, {
        includeLineNumbers: shouldIncludeLineNumbers,
      });
    },
  });

  return [execute_script];
}
