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
import { buildDockerCommand } from "../sandbox/docker-sandbox.js";
import { buildFirejailCommand } from "../sandbox/firejail-sandbox.js";
import { toToolJsonResult } from "./tool-json-result.js";

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

function resolveSandboxProvider(effectiveConfig = {}, globalConfig = {}) {
  const scriptCfg = effectiveConfig?.script || {};
  const globalScriptCfg = globalConfig?.script || {};
  const provider = String(
    scriptCfg?.sandboxProvider || globalScriptCfg?.sandboxProvider || "",
  )
    .trim()
    .toLowerCase();
  if (provider === "firejail" || provider === "fj") return "firejail";
  if (provider === "bubblewrap" || provider === "bwrap") return "bubblewrap";
  return "docker";
}

export function createScriptTool({ agentContext }) {
  const runtime = getRuntime(agentContext);
  const basePath = agentContext?.basePath || runtime.basePath || "";
  const globalConfig = runtime.globalConfig || {};
  const effectiveConfig = mergeConfig(globalConfig, runtime.userConfig || {});
  if (!basePath) return [];
  const workspace = path.join(basePath, "runtime/workspace");
  const userRoot = basePath;
  const sandboxEnabled = !!effectiveConfig?.script?.sandboxMode;
  const sandboxProvider = resolveSandboxProvider(effectiveConfig, globalConfig);
  const description = sandboxEnabled
    ? [
        `执行脚本（沙箱模式，provider=${sandboxProvider}）。`,
        ...(sandboxProvider === "bubblewrap"
          ? [
              "Bubblewrap + overlayfs 说明：",
              "- 宿主根文件系统作为 lowerdir",
              "- 用户目录下 runtime/sandbox/bubblewrap/overlay-upper|overlay-work 作为可写层",
              "- 命令固定在持久目录 /workspace/runtime/sandbox/persist 执行，文件可累加",
              "- 软件累加建议使用用户态安装：如 npm --prefix \"$HOME/.npm-global\"、pip install --user、将二进制放到 $HOME/bin",
            ]
          : sandboxProvider === "firejail"
            ? [
                "Firejail 说明：",
                "- 使用用户目录下 runtime/sandbox/firejail/home 作为持久 HOME",
                "- 命令固定在 $HOME/runtime/sandbox/persist 执行，文件可累加",
                "- 软件累加建议使用用户态安装：如 npm --prefix \"$HOME/.npm-global\"、pip install --user、将二进制放到 $HOME/bin",
              ]
          : [
              "Docker 说明：",
              "- 用户目录整体挂载到容器内 /workspace",
            ]),
        ...(sandboxProvider === "firejail"
          ? [
              "- 命令默认工作目录为 $HOME/runtime/sandbox/persist",
              "输入输出文件请使用该目录相对路径或 $HOME 下路径。",
            ]
          : sandboxProvider === "bubblewrap"
            ? [
                "- 命令默认工作目录为 /workspace/runtime/sandbox/persist",
                "输入输出文件请使用该目录相对路径或 /workspace 下路径。",
              ]
          : [
              "- 命令默认工作目录为 /workspace/runtime/workspace",
              "输入输出文件请使用该目录相对路径或 /workspace 下路径。",
            ]),
      ].join("\n")
    : [
        "执行脚本（local 模式）。",
        `命令在本机目录执行：${workspace}`,
        "输入输出文件请使用该目录下相对路径。",
      ].join("\n");

  const execute_script = new DynamicStructuredTool({
    name: "execute_script",
    description,
    schema: z.object({
      command: z.string().describe("要执行的 shell 命令"),
    }),
    func: async ({ command }) => {
      const timeout = effectiveConfig?.scriptTimeoutMs || 120000;
      if (!sandboxEnabled) {
        const r = await run(command, workspace, timeout);
        return toToolJsonResult("execute_script", {
          ok: Number(r?.code || 0) === 0,
          mode: "local",
          ...r,
        });
      }
      let sandboxCmd = "";
      let mode = "docker";
      let extra = {};
      if (sandboxProvider === "bubblewrap") {
        const bwrapInstalled = await hasCommand("bwrap");
        if (!bwrapInstalled) {
          return toToolJsonResult("execute_script", {
            ok: false,
            mode: "bubblewrap",
            code: 127,
            stdout: "",
            stderr: "bwrap 未安装，请先安装 bubblewrap",
          });
        }
        const supportsOverlaySrc = await bwrapSupportsOption("--overlay-src");
        if (!supportsOverlaySrc) {
          const dockerInstalled = await hasCommand("docker");
          if (dockerInstalled) {
            const dockerCmd = buildDockerCommand({ userRoot, command });
            const dr = await run(dockerCmd, workspace, timeout);
            return toToolJsonResult("execute_script", {
              ok: Number(dr?.code || 0) === 0,
              mode: "docker",
              fallbackFrom: "bubblewrap",
              warning:
                "当前 bubblewrap 版本不支持 --overlay-src，已自动回退到 docker。",
              ...dr,
            });
          }
          return toToolJsonResult("execute_script", {
            ok: false,
            mode: "bubblewrap",
            code: 2,
            stdout: "",
            stderr:
              "当前 bubblewrap 版本不支持 --overlay-src。请升级 bubblewrap，或将 script.sandboxProvider 改为 docker。",
          });
        }
        const built = buildBubblewrapCommand({ userRoot, command });
        try {
          await ensureBubblewrapOverlayReady({
            overlayUpper: built.overlayUpper,
            overlayWork: built.overlayWork,
          });
        } catch (err) {
          return toToolJsonResult("execute_script", {
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
        if (!firejailInstalled) {
          return toToolJsonResult("execute_script", {
            ok: false,
            mode: "firejail",
            code: 127,
            stdout: "",
            stderr: "firejail 未安装，请先安装 firejail",
          });
        }
        const built = buildFirejailCommand({ userRoot, command });
        sandboxCmd = built.cmd;
        mode = "firejail";
        extra = { sandboxHome: built.homeDir, persistDir: built.persistDir };
      } else {
        const dockerInstalled = await hasCommand("docker");
        if (!dockerInstalled) {
          return toToolJsonResult("execute_script", {
            ok: false,
            mode: "docker",
            code: 127,
            stdout: "",
            stderr: "docker 未安装，请先安装 docker",
          });
        }
        sandboxCmd = buildDockerCommand({ userRoot, command });
      }
      let r = await run(sandboxCmd, workspace, timeout);
      if (
        mode === "bubblewrap" &&
        Number(r?.code || 0) !== 0 &&
        /Can't make overlay mount|userxattr:\s*Invalid argument/i.test(
          String(r?.stderr || ""),
        )
      ) {
        const dockerInstalled = await hasCommand("docker");
        if (dockerInstalled) {
          const dockerCmd = buildDockerCommand({ userRoot, command });
          const dr = await run(dockerCmd, workspace, timeout);
          return toToolJsonResult("execute_script", {
            ok: Number(dr?.code || 0) === 0,
            mode: "docker",
            fallbackFrom: "bubblewrap",
            warning:
              "当前内核/发行版不支持 bubblewrap overlay(userxattr)，已自动回退到 docker。",
            ...dr,
          });
        }
        r = {
          ...r,
          stderr: `${String(r?.stderr || "")}\n当前系统不支持 bubblewrap overlay(userxattr)。请改用 script.sandboxProvider=docker，或升级内核开启 CONFIG_OVERLAY_FS_USERXATTR。`,
        };
      }
      return toToolJsonResult("execute_script", {
        ok: Number(r?.code || 0) === 0,
        mode,
        ...extra,
        ...r,
      });
    },
  });

  return [execute_script];
}
