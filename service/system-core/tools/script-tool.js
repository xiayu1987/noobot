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
  if (provider === "bubblewrap" || provider === "bwrap") return "bubblewrap";
  return "docker";
}

function buildBubblewrapCommand({ userRoot, workspace, command }) {
  const sandboxRoot = path.join(userRoot, "runtime/sandbox/bubblewrap");
  const overlayUpper = path.join(sandboxRoot, "overlay-upper");
  const overlayWork = path.join(sandboxRoot, "overlay-work");
  const homeDir = "/workspace/runtime/workspace";
  const argv = [
    "mkdir -p",
    JSON.stringify(overlayUpper),
    JSON.stringify(overlayWork),
    "&&",
    "bwrap",
    "--die-with-parent",
    "--new-session",
    "--unshare-all",
    "--share-net",
    "--proc",
    "/proc",
    "--dev",
    "/dev",
    "--ro-bind",
    "/sys",
    "/sys",
    "--overlay-src",
    "/",
    "--overlay",
    JSON.stringify(overlayUpper),
    JSON.stringify(overlayWork),
    "/",
    "--bind",
    JSON.stringify(userRoot),
    "/workspace",
    "--chdir",
    homeDir,
    "--setenv",
    "HOME",
    homeDir,
    "--setenv",
    "PWD",
    homeDir,
    "--tmpfs",
    "/tmp",
    "--tmpfs",
    "/var/tmp",
    "--",
    "bash",
    "-lc",
    JSON.stringify(command),
  ];
  return {
    cmd: argv.join(" "),
    sandboxRoot,
    overlayUpper,
    overlayWork,
  };
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
              "- 多次执行可复用可写层，实现“系统安装累加”",
            ]
          : [
              "Docker 说明：",
              "- 用户目录整体挂载到容器内 /workspace",
            ]),
        "- 命令默认工作目录为 /workspace/runtime/workspace",
        "输入输出文件请使用该目录相对路径或 /workspace 下路径。",
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
        const built = buildBubblewrapCommand({ userRoot, workspace, command });
        sandboxCmd = built.cmd;
        mode = "bubblewrap";
        extra = {
          sandboxRoot: built.sandboxRoot,
          overlayUpper: built.overlayUpper,
          overlayWork: built.overlayWork,
        };
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
        sandboxCmd = `docker run --rm -v "${userRoot}:/workspace" -w /workspace/runtime/workspace node:20 bash -lc ${JSON.stringify(command)}`;
      }
      const r = await run(sandboxCmd, workspace, timeout);
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
