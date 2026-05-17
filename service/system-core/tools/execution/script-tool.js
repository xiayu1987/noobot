/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { exec } from "node:child_process";
import path from "node:path";
import { DynamicStructuredTool } from "@langchain/core/tools";
import { z } from "zod";
import { mergeConfig } from "../../config/index.js";
import { normalizeSandboxProvider } from "../../config/index.js";
import { recoverableToolError } from "../../error/index.js";
import {
  buildBubblewrapCommand,
  bwrapSupportsOption,
  ensureBubblewrapOverlayReady,
} from "../../sandbox/bubblewrap-sandbox.js";
import {
  buildDockerCommand,
  normalizeDockerMounts,
  normalizeDockerContainerScope,
} from "../../sandbox/docker-sandbox.js";
import { buildFirejailCommand } from "../../sandbox/firejail-sandbox.js";
import { cleanTerminalOutputForLLM } from "../../utils/cleaners/output-cleaner.js";
import { toToolJsonResult } from "../core/tool-json-result.js";
import { tTool } from "../core/tool-i18n.js";
import { ERROR_CODE } from "../../error/constants.js";
import { SandboxConfig } from "../constants/index.js";

const TOOL_NAME = "execute_script";
const DEFAULT_TIMEOUT = 120000;
const DEFAULT_MAX_OUTPUT_CHARS = 20000;
const SANDBOX_PROVIDER_NAME = SandboxConfig.PROVIDERS;
const DOCKER_SANDBOX_DEFAULT = SandboxConfig.DOCKER;
const SANDBOX_COMMAND = SandboxConfig.COMMANDS;

function run(cmd, cwd, timeoutMs) {
  return new Promise((resolve) => {
    exec(cmd, { cwd, timeout: timeoutMs }, (error, stdout, stderr) => {
      resolve({
        code: error?.code || 0,
        stdout,
        stderr: stderr || error?.message || "",
      });
    });
  });
}

function getRuntime(agentContext) {
  return agentContext?.runtime || {};
}

function tScript(runtime = {}, key = "", params = {}) {
  return tTool(runtime, `tools.script.${String(key || "").trim()}`, params);
}

function hasCommand(commandName = "") {
  return new Promise((resolve) => {
    exec(`command -v ${JSON.stringify(String(commandName || ""))}`, (error) => {
      resolve(!error);
    });
  });
}


function resolveSandboxProviderConfig(scriptConfig = {}) {
  const providerConfig = scriptConfig?.sandboxProvider;
  if (!providerConfig || typeof providerConfig !== "object" || Array.isArray(providerConfig)) {
    return { provider: SANDBOX_PROVIDER_NAME.DOCKER, providerDetail: {} };
  }
  const provider = normalizeSandboxProvider(
    providerConfig?.default || SANDBOX_PROVIDER_NAME.DOCKER,
  );
  const detail =
    providerConfig?.[provider] &&
    typeof providerConfig?.[provider] === "object" &&
    !Array.isArray(providerConfig?.[provider])
      ? providerConfig?.[provider]
      : {};
  return { provider, providerDetail: detail };
}

function resolveDockerScriptConfig(scriptConfig = {}, providerDetail = {}) {
  void scriptConfig;
  return {
    dockerContainerScope:
      providerDetail?.dockerContainerScope ||
      DOCKER_SANDBOX_DEFAULT.DEFAULT_CONTAINER_SCOPE,
    dockerContainerName:
      providerDetail?.dockerContainerName ||
      DOCKER_SANDBOX_DEFAULT.DEFAULT_CONTAINER_NAME,
    dockerImage: providerDetail?.dockerImage || DOCKER_SANDBOX_DEFAULT.DEFAULT_IMAGE,
    dockerMounts: Array.isArray(providerDetail?.dockerMounts)
      ? providerDetail.dockerMounts
      : [],
    dockerProjectMountSource: String(
      providerDetail?.dockerProjectMountSource || "",
    ).trim(),
    dockerProjectMountTarget:
      String(providerDetail?.dockerProjectMountTarget || "").trim() || "/project",
  };
}

function toSafePositiveInt(value, fallback = 0, min = 1) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return Math.max(min, Number(fallback || 0));
  return Math.max(min, Math.floor(parsed));
}

function resolveScriptOutputPolicy(toolsConfig = {}) {
  const toolsCfg =
    toolsConfig && typeof toolsConfig === "object" && !Array.isArray(toolsConfig)
      ? toolsConfig
      : {};
  const maxOutputChars = toSafePositiveInt(
    toolsCfg?.maxOutputChars,
    DEFAULT_MAX_OUTPUT_CHARS,
    256,
  );
  return {
    maxOutputChars,
  };
}

function shouldCleanScriptOutput(r = {}, policy = {}) {
  const stdout = String(r?.stdout || "");
  const stderr = String(r?.stderr || "");
  const maxChars = toSafePositiveInt(
    policy?.maxOutputChars,
    DEFAULT_MAX_OUTPUT_CHARS,
    256,
  );
  return stdout.length > maxChars || stderr.length > maxChars;
}

function normalizeScriptOutput(r = {}, policy = {}) {
  if (!shouldCleanScriptOutput(r, policy)) return { normalized: r, cleaned: false };
  const maxChars = toSafePositiveInt(
    policy?.maxOutputChars,
    DEFAULT_MAX_OUTPUT_CHARS,
    256,
  );
  const cleanedResult = cleanTerminalOutputForLLM(r, { maxChars });
  return {
    normalized: {
      ...r,
      ...cleanedResult,
    },
    cleaned: true,
  };
}

function toolExecResult(mode, r = {}, extra = {}, outputPolicy = {}) {
  const { normalized, cleaned } = normalizeScriptOutput(r, outputPolicy);
  return toToolJsonResult(TOOL_NAME, {
    ok: Number(normalized?.code || 0) === 0,
    mode,
    output_cleaned: cleaned,
    __max_output_chars: outputPolicy?.maxOutputChars,
    ...extra,
    ...normalized,
  });
}

function missingCommandError(mode, commandName = "", runtime = {}) {
  return recoverableToolError(
    tScript(runtime, "commandNotInstalled", { commandName }),
    {
      code: ERROR_CODE.RECOVERABLE_COMMAND_NOT_INSTALLED,
      details: {
        mode,
        commandName,
        code: 127,
      },
    },
  );
}

function scriptRuntimeError(message = "", options = {}) {
  return recoverableToolError(String(message || "").trim(), {
    code: String(options?.code || ERROR_CODE.RECOVERABLE_SCRIPT_RUNTIME_ERROR),
    details:
      options?.details && typeof options.details === "object"
        ? options.details
        : {},
  });
}

async function runDockerCommand({
  userRoot,
  userId = "",
  command,
  workspace,
  timeout,
  scriptConfig = {},
}) {
  const built = buildDockerCommand({ userRoot, userId, command, scriptConfig });
  const result = await run(built.cmd, workspace, timeout);
  return { result, docker: built };
}

async function tryDockerFallback({
  userRoot,
  userId = "",
  command,
  workspace,
  timeout,
  scriptConfig = {},
  outputPolicy = {},
  fallbackFrom,
  warning,
}) {
  const dockerInstalled = await hasCommand(SANDBOX_COMMAND.DOCKER);
  if (!dockerInstalled) return null;
  const { result: dr, docker } = await runDockerCommand({
    userRoot,
    userId,
    command,
    workspace,
    timeout,
    scriptConfig,
  });
  return toolExecResult(
    SANDBOX_PROVIDER_NAME.DOCKER,
    dr,
    {
      fallbackFrom,
      warning,
      containerName: docker?.containerName || "",
      containerScope: docker?.scope || "",
      containerImage: docker?.image || "",
      containerMountSource: docker?.mountSource || "",
      containerMountTarget: docker?.mountTarget || "",
      containerExtraMounts: Array.isArray(docker?.dockerMounts)
        ? docker.dockerMounts
        : [],
      containerProjectMountSource:
        Array.isArray(docker?.dockerMounts) && docker.dockerMounts[0]
          ? String(docker.dockerMounts[0].source || "")
          : "",
      containerProjectMountTarget:
        Array.isArray(docker?.dockerMounts) && docker.dockerMounts[0]
          ? String(docker.dockerMounts[0].target || "")
          : "",
      containerWorkdir: docker?.workdir || "",
    },
    outputPolicy,
  );
}

function buildScriptToolDescription({
  runtime,
  sandboxEnabled,
  sandboxProvider,
  workspace,
  dockerConfig = {},
}) {
  if (!sandboxEnabled) {
    return [
      tTool(runtime, "tools.script.localModeTitle"),
      `${tTool(runtime, "tools.script.localModeWorkspacePrefix")}${workspace}`,
      tTool(runtime, "tools.script.localModePathHint"),
    ].join("\n");
  }

  const dockerScope = normalizeDockerContainerScope(dockerConfig);
  const dockerMounts = normalizeDockerMounts(dockerConfig);
  const dockerMountDescriptionLines = dockerMounts.length
    ? [
        tTool(runtime, "tools.script.docker.mounts.title"),
        ...dockerMounts.map((item) =>
          tTool(runtime, "tools.script.docker.mounts.item", {
            source: item.source,
            target: item.target,
            description: item.description,
          }),
        ),
      ]
    : [tTool(runtime, "tools.script.docker.mounts.none")];
  const providerDescriptionMap = {
    [SANDBOX_PROVIDER_NAME.BUBBLEWRAP]: [
      tTool(runtime, "tools.script.bubblewrap.title"),
      tTool(runtime, "tools.script.bubblewrap.line1"),
      tTool(runtime, "tools.script.bubblewrap.line2"),
      tTool(runtime, "tools.script.bubblewrap.line3"),
      tTool(runtime, "tools.script.commonUserInstallHint"),
    ],
    [SANDBOX_PROVIDER_NAME.FIREJAIL]: [
      tTool(runtime, "tools.script.firejail.title"),
      tTool(runtime, "tools.script.firejail.line1"),
      tTool(runtime, "tools.script.firejail.line2"),
      tTool(runtime, "tools.script.commonUserInstallHint"),
    ],
    [SANDBOX_PROVIDER_NAME.DOCKER]: [
      tTool(runtime, "tools.script.docker.title"),
      `- ${
        dockerScope === "user"
          ? tTool(runtime, "tools.script.docker.scope.user")
          : tTool(runtime, "tools.script.docker.scope.global")
      }`,
      tTool(runtime, "tools.script.docker.reuse"),
      ...dockerMountDescriptionLines,
    ],
  };

  const workdirDescriptionMap = {
    [SANDBOX_PROVIDER_NAME.FIREJAIL]: [
      tTool(runtime, "tools.script.workdir.firejail.line1"),
      tTool(runtime, "tools.script.workdir.firejail.line2"),
    ],
    [SANDBOX_PROVIDER_NAME.BUBBLEWRAP]: [
      tTool(runtime, "tools.script.workdir.bubblewrap.line1"),
      tTool(runtime, "tools.script.workdir.commonPathHint"),
    ],
    [SANDBOX_PROVIDER_NAME.DOCKER]:
      dockerScope === "user"
        ? [
            tTool(runtime, "tools.script.workdir.docker.user.line1"),
            tTool(runtime, "tools.script.workdir.commonPathHint"),
          ]
        : [
            tTool(runtime, "tools.script.workdir.docker.global.line1"),
            tTool(runtime, "tools.script.workdir.commonPathHint"),
          ],
  };

  return [
    `${tTool(runtime, "tools.script.sandboxModeTitlePrefix")}${sandboxProvider}${tTool(runtime, "tools.script.sandboxModeTitleSuffix")}`,
    ...(providerDescriptionMap[sandboxProvider] ||
      providerDescriptionMap[SANDBOX_PROVIDER_NAME.DOCKER]),
    ...(workdirDescriptionMap[sandboxProvider] ||
      workdirDescriptionMap[SANDBOX_PROVIDER_NAME.DOCKER]),
  ].join("\n");
}

export function createScriptTool({ agentContext }) {
  const runtime = getRuntime(agentContext);
  const basePath =
    agentContext?.environment?.workspace?.basePath || runtime.basePath || "";
  const globalConfig = runtime.globalConfig || {};
  const effectiveConfig = mergeConfig(globalConfig, runtime.userConfig || {});
  if (!basePath) return [];

  const workspace = path.join(basePath, "runtime/workspace");
  const userRoot = basePath;
  const userId = String(runtime?.userId || "").trim();
  const scriptConfig =
    effectiveConfig?.tools?.execute_script &&
    typeof effectiveConfig.tools.execute_script === "object" &&
    !Array.isArray(effectiveConfig.tools.execute_script)
      ? effectiveConfig.tools.execute_script
      : {};
  const sandboxEnabled = !!scriptConfig?.sandboxMode;
  const { provider: sandboxProvider, providerDetail } =
    resolveSandboxProviderConfig(scriptConfig);
  const dockerConfig = resolveDockerScriptConfig(scriptConfig, providerDetail);
  const scriptOutputPolicy = resolveScriptOutputPolicy(effectiveConfig?.tools);
  const description = buildScriptToolDescription({
    runtime,
    sandboxEnabled,
    sandboxProvider,
    workspace,
    dockerConfig,
  });

  const execute_script = new DynamicStructuredTool({
    name: TOOL_NAME,
    description,
    schema: z.object({
      command: z.string().describe(tTool(runtime, "tools.script.fieldCommand")),
    }),
    func: async ({ command }) => {
      const timeout = Number(scriptConfig?.scriptTimeoutMs || DEFAULT_TIMEOUT);

      if (!sandboxEnabled) {
        const runResult = await run(command, workspace, timeout);
        return toolExecResult("local", runResult, {}, scriptOutputPolicy);
      }

      let sandboxCmd = "";
      let mode = SANDBOX_PROVIDER_NAME.DOCKER;
      let extra = {};

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
            command,
            workspace,
            timeout,
            scriptConfig: dockerConfig,
            outputPolicy: scriptOutputPolicy,
            fallbackFrom: SANDBOX_PROVIDER_NAME.BUBBLEWRAP,
            warning: tScript(runtime, "fallbackOverlaySrc"),
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

        const built = buildBubblewrapCommand({ userRoot, command });
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
        extra = {
          sandboxRoot: built.sandboxRoot,
          overlayUpper: built.overlayUpper,
          overlayWork: built.overlayWork,
          persistDir: built.persistDir,
        };
      } else if (sandboxProvider === SANDBOX_PROVIDER_NAME.FIREJAIL) {
        const firejailInstalled = await hasCommand(SANDBOX_COMMAND.FIREJAIL);
        if (!firejailInstalled) {
          throw missingCommandError(
            SANDBOX_PROVIDER_NAME.FIREJAIL,
            SANDBOX_COMMAND.FIREJAIL,
            runtime,
          );
        }

        const built = buildFirejailCommand({ userRoot, command });
        sandboxCmd = built.cmd;
        mode = SANDBOX_PROVIDER_NAME.FIREJAIL;
        extra = { sandboxHome: built.homeDir, persistDir: built.persistDir };
      } else {
        const dockerInstalled = await hasCommand(SANDBOX_COMMAND.DOCKER);
        if (!dockerInstalled) {
          throw missingCommandError(
            SANDBOX_PROVIDER_NAME.DOCKER,
            SANDBOX_COMMAND.DOCKER,
            runtime,
          );
        }
        const built = buildDockerCommand({
          userRoot,
          userId,
          command,
          scriptConfig: dockerConfig,
        });
        sandboxCmd = built.cmd;
        extra = {
          containerName: built.containerName,
          containerScope: built.scope,
          containerImage: built.image,
          containerMountSource: built.mountSource,
          containerMountTarget: built.mountTarget,
          containerExtraMounts: Array.isArray(built?.dockerMounts)
            ? built.dockerMounts
            : [],
          containerProjectMountSource:
            Array.isArray(built?.dockerMounts) && built.dockerMounts[0]
              ? String(built.dockerMounts[0].source || "")
              : "",
          containerProjectMountTarget:
            Array.isArray(built?.dockerMounts) && built.dockerMounts[0]
              ? String(built.dockerMounts[0].target || "")
              : "",
          containerWorkdir: built.workdir,
        };
      }

      let runResult = await run(sandboxCmd, workspace, timeout);
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
          command,
          workspace,
          timeout,
          scriptConfig: dockerConfig,
          outputPolicy: scriptOutputPolicy,
          fallbackFrom: SANDBOX_PROVIDER_NAME.BUBBLEWRAP,
          warning: tScript(runtime, "fallbackUserxattr"),
        });
        if (fallbackResult) return fallbackResult;
        runResult = {
          ...runResult,
          stderr: tScript(runtime, "userxattrUnsupported", {
            stderr: String(runResult?.stderr || ""),
          }),
        };
      }
      return toolExecResult(mode, runResult, extra, scriptOutputPolicy);
    },
  });

  return [execute_script];
}
