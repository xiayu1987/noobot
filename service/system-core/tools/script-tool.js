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

export function createScriptTool({ agentContext }) {
  const runtime = getRuntime(agentContext);
  const basePath = agentContext?.basePath || runtime.basePath || "";
  const globalConfig = runtime.globalConfig || {};
  const effectiveConfig = mergeConfig(globalConfig, runtime.userConfig || {});
  if (!basePath) return [];
  const workspace = path.join(basePath, "runtime/workspace");
  const userRoot = basePath;
  const sandboxEnabled = !!globalConfig?.script?.sandboxMode;
  const description = sandboxEnabled
    ? [
        "执行脚本（docker 沙箱模式）。",
        "沙箱内目录约定：",
        "- 用户目录整体挂载到容器内 /workspace",
        "- 命令默认工作目录为 /workspace/runtime/workspace",
        "输入输出文件请使用容器内路径（推荐相对当前目录或 /workspace 下路径）。",
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
      const dockerCmd = `docker run --rm -v "${userRoot}:/workspace" -w /workspace/runtime/workspace node:20 bash -lc ${JSON.stringify(command)}`;
      const r = await run(dockerCmd, workspace, timeout);
      return toToolJsonResult("execute_script", {
        ok: Number(r?.code || 0) === 0,
        mode: "docker",
        ...r,
      });
    },
  });

  return [execute_script];
}
