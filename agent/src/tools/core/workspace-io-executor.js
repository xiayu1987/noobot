/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { mkdir, readFile, rename, rm, stat, unlink, writeFile } from "node:fs/promises";
import { filePath as path } from "@noobot/path-resolver";
import {
  TOOL_EXECUTION_CLASS,
  TOOL_EXECUTION_VIEW,
  assertToolExecutionPolicy,
} from "@noobot/execution-isolation-protocol";

export function createWorkspaceIoExecutor({ executionPolicy } = {}) {
  const policy = assertToolExecutionPolicy(executionPolicy);
  if (
    policy.executionClass !== TOOL_EXECUTION_CLASS.WORKSPACE_IO ||
    policy.view !== TOOL_EXECUTION_VIEW.SERVICE_HOST
  ) {
    throw new Error("workspace I/O requires the service-host execution policy");
  }
  return Object.freeze({
    view: policy.view,
    stat: (filePath) => stat(filePath),
    readText: (filePath) => readFile(filePath, "utf8"),
    async writeText(filePath, content) {
      await mkdir(path.dirname(filePath), { recursive: true });
      const temporary = path.join(
        path.dirname(filePath),
        `.${path.basename(filePath)}.noobot-${process.pid}-${Date.now()}`,
      );
      try {
        await writeFile(temporary, content, "utf8");
        await rename(temporary, filePath);
      } catch (error) {
        await rm(temporary, { force: true }).catch(() => {});
        throw error;
      }
    },
    async remove(filePath) {
      await unlink(filePath);
    },
    async exists(filePath) {
      return Boolean(await stat(filePath).catch(() => null));
    },
  });
}
