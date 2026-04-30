/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { exec } from "node:child_process";
import path from "node:path";
import { DynamicStructuredTool } from "@langchain/core/tools";
import { z } from "zod";
import { mergeConfig } from "../config/index.js";
import {
  buildBubblewrapCommand,
  bwrapSupportsOption,
  ensureBubblewrapOverlayReady,
} from "../sandbox/bubblewrap-sandbox.js";
import {
  buildDockerCommand,
  resolveDockerContainerScope,
} from "../sandbox/docker-sandbox.js";
import { buildFirejailCommand } from "../sandbox/firejail-sandbox.js";
import { toToolJsonResult } from "./tool-json-result.js";
import { pickToolText, resolveToolLocale, tTool } from "./tool-i18n.js";

const TOOL_NAME = "execute_script";
const DEFAULT_TIMEOUT = 120000;

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
  const locale = resolveToolLocale(runtime);
  const dict = {
    commandNotInstalled: {
      "zh-CN": `${String(params.commandName || "").trim()} 未安装，请先安装 ${String(params.commandName || "").trim()}`,
      "en-US": `${String(params.commandName || "").trim()} is not installed. Please install ${String(params.commandName || "").trim()} first.`,
    },
    fallbackOverlaySrc: {
      "zh-CN": "当前 bubblewrap 版本不支持 --overlay-src，已自动回退到 docker。",
      "en-US": "Current bubblewrap version does not support --overlay-src. Automatically fell back to docker.",
    },
    overlaySrcUnsupported: {
      "zh-CN": "当前 bubblewrap 版本不支持 --overlay-src。请升级 bubblewrap，或将 tools.execute_script.sandbox_provider.default 改为 docker。",
      "en-US": "Current bubblewrap version does not support --overlay-src. Upgrade bubblewrap, or switch tools.execute_script.sandbox_provider.default to docker.",
    },
    overlayDirNotWritable: {
      "zh-CN": `bubblewrap overlay 目录不可写，请检查权限（建议执行：sudo chown -R $(id -u):$(id -g) \"${String(params.sandboxRoot || "").trim()}\"）。${String(params.reason || "").trim()}`,
      "en-US": `bubblewrap overlay directory is not writable. Check permissions (suggestion: sudo chown -R $(id -u):$(id -g) \"${String(params.sandboxRoot || "").trim()}\"). ${String(params.reason || "").trim()}`,
    },
    fallbackUserxattr: {
      "zh-CN": "当前内核/发行版不支持 bubblewrap overlay(userxattr)，已自动回退到 docker。",
      "en-US": "Current kernel/distribution does not support bubblewrap overlay(userxattr). Automatically fell back to docker.",
    },
    userxattrUnsupported: {
      "zh-CN": `${String(params.stderr || "")}\n当前系统不支持 bubblewrap overlay(userxattr)。请改用 tools.execute_script.sandbox_provider.default=docker，或升级内核开启 CONFIG_OVERLAY_FS_USERXATTR。`,
      "en-US": `${String(params.stderr || "")}\nCurrent system does not support bubblewrap overlay(userxattr). Use tools.execute_script.sandbox_provider.default=docker, or upgrade kernel with CONFIG_OVERLAY_FS_USERXATTR enabled.`,
    },
  };
  return pickToolText({ locale, dict, key, params });
}

function hasCommand(commandName = "") {
  return new Promise((resolve) => {
    exec(`command -v ${JSON.stringify(String(commandName || ""))}`, (error) => {
      resolve(!error);
    });
  });
}

function normalizeSandboxProvider(provider = "") {
  const normalized = String(provider || "")
    .trim()
    .toLowerCase();
  if (normalized === "firejail" || normalized === "fj") return "firejail";
  if (normalized === "bubblewrap" || normalized === "bwrap") return "bubblewrap";
  return "docker";
}

function resolveSandboxProviderConfig(scriptConfig = {}) {
  const providerConfig = scriptConfig?.sandboxProvider;
  if (!providerConfig || typeof providerConfig !== "object" || Array.isArray(providerConfig)) {
    return { provider: "docker", providerDetail: {} };
  }
  const provider = normalizeSandboxProvider(providerConfig?.default || "docker");
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
      providerDetail?.dockerContainerScope || "global",
    dockerContainerName:
      providerDetail?.dockerContainerName || "noobot-script-sandbox",
    dockerImage: providerDetail?.dockerImage || "node:20",
  };
}

function toolExecResult(mode, r = {}, extra = {}) {
  return toToolJsonResult(TOOL_NAME, {
    ok: Number(r?.code || 0) === 0,
    mode,
    ...extra,
    ...r,
  });
}

function missingCommandResult(mode, commandName = "", runtime = {}) {
  return toToolJsonResult(TOOL_NAME, {
    ok: false,
    mode,
    code: 127,
    stdout: "",
    stderr: tScript(runtime, "commandNotInstalled", { commandName }),
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
  fallbackFrom,
  warning,
}) {
  const dockerInstalled = await hasCommand("docker");
  if (!dockerInstalled) return null;
  const { result: dr, docker } = await runDockerCommand({
    userRoot,
    userId,
    command,
    workspace,
    timeout,
    scriptConfig,
  });
  return toToolJsonResult(TOOL_NAME, {
    ok: Number(dr?.code || 0) === 0,
    mode: "docker",
    fallbackFrom,
    warning,
    containerName: docker?.containerName || "",
    containerScope: docker?.scope || "",
    containerImage: docker?.image || "",
    containerMountSource: docker?.mountSource || "",
    containerWorkdir: docker?.workdir || "",
    ...dr,
  });
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

  const dockerScope = resolveDockerContainerScope(dockerConfig);
  const providerDescriptionMap = {
    bubblewrap: [
      tTool(runtime, "tools.script.bubblewrap.title"),
      tTool(runtime, "tools.script.bubblewrap.line1"),
      tTool(runtime, "tools.script.bubblewrap.line2"),
      tTool(runtime, "tools.script.bubblewrap.line3"),
      tTool(runtime, "tools.script.bubblewrap.line4"),
    ],
    firejail: [
      tTool(runtime, "tools.script.firejail.title"),
      tTool(runtime, "tools.script.firejail.line1"),
      tTool(runtime, "tools.script.firejail.line2"),
      tTool(runtime, "tools.script.firejail.line3"),
    ],
    docker: [
      tTool(runtime, "tools.script.docker.title"),
      `- ${
        dockerScope === "user"
          ? tTool(runtime, "tools.script.docker.scope.user")
          : tTool(runtime, "tools.script.docker.scope.global")
      }`,
      tTool(runtime, "tools.script.docker.reuse"),
    ],
  };

  const workdirDescriptionMap = {
    firejail: [
      tTool(runtime, "tools.script.workdir.firejail.line1"),
      tTool(runtime, "tools.script.workdir.firejail.line2"),
    ],
    bubblewrap: [
      tTool(runtime, "tools.script.workdir.bubblewrap.line1"),
      tTool(runtime, "tools.script.workdir.bubblewrap.line2"),
    ],
    docker:
      dockerScope === "user"
        ? [
            tTool(runtime, "tools.script.workdir.docker.user.line1"),
            tTool(runtime, "tools.script.workdir.docker.user.line2"),
          ]
        : [
            tTool(runtime, "tools.script.workdir.docker.global.line1"),
            tTool(runtime, "tools.script.workdir.docker.global.line2"),
          ],
  };

  return [
    `${tTool(runtime, "tools.script.sandboxModeTitlePrefix")}${sandboxProvider}${tTool(runtime, "tools.script.sandboxModeTitleSuffix")}`,
    ...(providerDescriptionMap[sandboxProvider] || providerDescriptionMap.docker),
    ...(workdirDescriptionMap[sandboxProvider] || workdirDescriptionMap.docker),
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
        return toolExecResult("local", runResult);
      }

      let sandboxCmd = "";
      let mode = "docker";
      let extra = {};

      if (sandboxProvider === "bubblewrap") {
        const bwrapInstalled = await hasCommand("bwrap");
        if (!bwrapInstalled) return missingCommandResult("bubblewrap", "bwrap", runtime);

        const supportsOverlaySrc = await bwrapSupportsOption("--overlay-src");
        if (!supportsOverlaySrc) {
          const fallbackResult = await tryDockerFallback({
            userRoot,
            userId,
            command,
            workspace,
            timeout,
            scriptConfig: dockerConfig,
            fallbackFrom: "bubblewrap",
            warning: tScript(runtime, "fallbackOverlaySrc"),
          });
          if (fallbackResult) return fallbackResult;
          return toToolJsonResult(TOOL_NAME, {
            ok: false,
            mode: "bubblewrap",
            code: 2,
            stdout: "",
            stderr: tScript(runtime, "overlaySrcUnsupported"),
          });
        }

        const built = buildBubblewrapCommand({ userRoot, command });
        try {
          await ensureBubblewrapOverlayReady({
            overlayUpper: built.overlayUpper,
            overlayWork: built.overlayWork,
          });
        } catch (err) {
          return toToolJsonResult(TOOL_NAME, {
            ok: false,
            mode: "bubblewrap",
            code: 13,
            stdout: "",
            sandboxRoot: built.sandboxRoot,
            overlayUpper: built.overlayUpper,
            overlayWork: built.overlayWork,
            stderr: tScript(runtime, "overlayDirNotWritable", {
              sandboxRoot: built.sandboxRoot,
              reason: err?.message || String(err),
            }),
          });
        }
        sandboxCmd = built.cmd;
        mode = "bubblewrap";
        extra = {
          sandboxRoot: built.sandboxRoot,
          overlayUpper: built.overlayUpper,
          overlayWork: built.overlayWork,
          persistDir: built.persistDir,
        };
      } else if (sandboxProvider === "firejail") {
        const firejailInstalled = await hasCommand("firejail");
        if (!firejailInstalled) {
          return missingCommandResult("firejail", "firejail", runtime);
        }

        const built = buildFirejailCommand({ userRoot, command });
        sandboxCmd = built.cmd;
        mode = "firejail";
        extra = { sandboxHome: built.homeDir, persistDir: built.persistDir };
      } else {
        const dockerInstalled = await hasCommand("docker");
        if (!dockerInstalled) return missingCommandResult("docker", "docker", runtime);
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
          containerWorkdir: built.workdir,
        };
      }

      let runResult = await run(sandboxCmd, workspace, timeout);
      if (
        mode === "bubblewrap" &&
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
          fallbackFrom: "bubblewrap",
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
      return toolExecResult(mode, runResult, extra);
    },
  });

  return [execute_script];
}
