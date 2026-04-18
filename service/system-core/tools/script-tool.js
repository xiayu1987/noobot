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

  const execute_script = new DynamicStructuredTool({
    name: "execute_script",
    description: "执行脚本。根据配置选择 local 或 docker sandbox 模式。",
    schema: z.object({
      command: z.string().describe("要执行的 shell 命令"),
    }),
    func: async ({ command }) => {
      const timeout = effectiveConfig?.scriptTimeoutMs || 120000;
      const sandbox = !!globalConfig?.script?.sandboxMode;
      if (!sandbox) {
        const r = await run(command, workspace, timeout);
        return JSON.stringify({ mode: "local", ...r });
      }
      const dockerCmd = `docker run --rm -v "${workspace}:/workspace" -w /workspace node:20 bash -lc ${JSON.stringify(command)}`;
      const r = await run(dockerCmd, workspace, timeout);
      return JSON.stringify({ mode: "docker", ...r });
    },
  });

  return [execute_script];
}
