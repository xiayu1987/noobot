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

function missingCommandResult(mode, commandName = "") {
  return toToolJsonResult(TOOL_NAME, {
    ok: false,
    mode,
    code: 127,
    stdout: "",
    stderr: `${commandName} 未安装，请先安装 ${commandName}`,
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
  sandboxEnabled,
  sandboxProvider,
  workspace,
  dockerConfig = {},
}) {
  if (!sandboxEnabled) {
    return [
      "执行脚本（local 模式）。",
      `命令在本机目录执行：${workspace}`,
      "输入输出文件请使用该目录下相对路径。",
    ].join("\n");
  }

  const dockerScope = resolveDockerContainerScope(dockerConfig);
  const providerDescriptionMap = {
    bubblewrap: [
      "Bubblewrap + overlayfs 说明：",
      "- 宿主根文件系统作为 lowerdir",
      "- 用户目录下 runtime/sandbox/bubblewrap/overlay-upper|overlay-work 作为可写层",
      "- 命令固定在持久目录 /workspace/runtime/sandbox/persist 执行，文件可累加",
      "- 软件累加建议使用用户态安装：如 npm --prefix \"$HOME/.npm-global\"、pip install --user、将二进制放到 $HOME/bin",
    ],
    firejail: [
      "Firejail 说明：",
      "- 使用用户目录下 runtime/sandbox/firejail/home 作为持久 HOME",
      "- 命令固定在 $HOME/runtime/sandbox/persist 执行，文件可累加",
      "- 软件累加建议使用用户态安装：如 npm --prefix \"$HOME/.npm-global\"、pip install --user、将二进制放到 $HOME/bin",
    ],
    docker: [
      "Docker 说明：",
      `- 容器复用范围：${dockerScope === "user" ? "按用户独立容器" : "所有用户共用同一容器（默认）"}`,
      "- 首次执行会自动创建容器，后续复用同一容器（不删除），可累加安装软件",
    ],
  };

  const workdirDescriptionMap = {
    firejail: [
      "- 命令默认工作目录为 $HOME/runtime/sandbox/persist",
      "输入输出文件请使用该目录相对路径或 $HOME 下路径。",
    ],
    bubblewrap: [
      "- 命令默认工作目录为 /workspace/runtime/sandbox/persist",
      "输入输出文件请使用该目录相对路径或 /workspace 下路径。",
    ],
    docker:
      dockerScope === "user"
        ? [
            "- 命令默认工作目录为 /workspace/runtime/workspace",
            "输入输出文件请使用该目录相对路径或 /workspace 下路径。",
          ]
        : [
            "- 命令默认工作目录为 /workspace/<userId>/runtime/workspace",
            "输入输出文件请使用该目录相对路径或 /workspace 下路径。",
          ],
  };

  return [
    `执行脚本（沙箱模式，provider=${sandboxProvider}）。`,
    ...(providerDescriptionMap[sandboxProvider] || providerDescriptionMap.docker),
    ...(workdirDescriptionMap[sandboxProvider] || workdirDescriptionMap.docker),
  ].join("\n");
}

export function createScriptTool({ agentContext }) {
  const runtime = getRuntime(agentContext);
  const basePath = agentContext?.basePath || runtime.basePath || "";
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
    sandboxEnabled,
    sandboxProvider,
    workspace,
    dockerConfig,
  });

  const execute_script = new DynamicStructuredTool({
    name: TOOL_NAME,
    description,
    schema: z.object({
      command: z.string().describe("要执行的 shell 命令"),
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
        if (!bwrapInstalled) return missingCommandResult("bubblewrap", "bwrap");

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
            warning: "当前 bubblewrap 版本不支持 --overlay-src，已自动回退到 docker。",
          });
          if (fallbackResult) return fallbackResult;
          return toToolJsonResult(TOOL_NAME, {
            ok: false,
            mode: "bubblewrap",
            code: 2,
            stdout: "",
            stderr:
              "当前 bubblewrap 版本不支持 --overlay-src。请升级 bubblewrap，或将 tools.execute_script.sandbox_provider.default 改为 docker。",
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
            stderr: `bubblewrap overlay 目录不可写，请检查权限（建议执行：sudo chown -R $(id -u):$(id -g) "${built.sandboxRoot}"）。${err?.message || String(err)}`,
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
        if (!firejailInstalled) return missingCommandResult("firejail", "firejail");

        const built = buildFirejailCommand({ userRoot, command });
        sandboxCmd = built.cmd;
        mode = "firejail";
        extra = { sandboxHome: built.homeDir, persistDir: built.persistDir };
      } else {
        const dockerInstalled = await hasCommand("docker");
        if (!dockerInstalled) return missingCommandResult("docker", "docker");
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
          warning:
            "当前内核/发行版不支持 bubblewrap overlay(userxattr)，已自动回退到 docker。",
        });
        if (fallbackResult) return fallbackResult;
        runResult = {
          ...runResult,
          stderr: `${String(runResult?.stderr || "")}\n当前系统不支持 bubblewrap overlay(userxattr)。请改用 tools.execute_script.sandbox_provider.default=docker，或升级内核开启 CONFIG_OVERLAY_FS_USERXATTR。`,
        };
      }
      return toolExecResult(mode, runResult, extra);
    },
  });

  return [execute_script];
}
