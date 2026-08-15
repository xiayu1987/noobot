/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { mkdir, readFile, readdir, rename, rm, stat, unlink, writeFile } from "node:fs/promises";
import { filePath as path } from "@noobot/path-resolver";
import {
  TOOL_EXECUTION_CLASS,
  TOOL_EXECUTION_VIEW,
  assertToolExecutionPolicy,
} from "@noobot/execution-isolation-protocol";
import {
  ATOMIC_RENAME_RETRY_DELAYS_MS,
  writeFileAtomic,
} from "../../shared/storage/atomic-file-write.js";

export function createWorkspaceIoExecutor({
  executionPolicy,
  atomicRenameRetryDelaysMs = ATOMIC_RENAME_RETRY_DELAYS_MS,
  fileSystem = {},
} = {}) {
  const policy = assertToolExecutionPolicy(executionPolicy);
  if (
    policy.executionClass !== TOOL_EXECUTION_CLASS.WORKSPACE_IO ||
    policy.view !== TOOL_EXECUTION_VIEW.SERVICE_HOST
  ) {
    throw new Error("workspace I/O requires the service-host execution policy");
  }
  const operations = {
    mkdir: typeof fileSystem.mkdir === "function" ? fileSystem.mkdir : mkdir,
    readFile: typeof fileSystem.readFile === "function" ? fileSystem.readFile : readFile,
    readdir: typeof fileSystem.readdir === "function" ? fileSystem.readdir : readdir,
    rename: typeof fileSystem.rename === "function" ? fileSystem.rename : rename,
    rm: typeof fileSystem.rm === "function" ? fileSystem.rm : rm,
    stat: typeof fileSystem.stat === "function" ? fileSystem.stat : stat,
    unlink: typeof fileSystem.unlink === "function" ? fileSystem.unlink : unlink,
    writeFile: typeof fileSystem.writeFile === "function" ? fileSystem.writeFile : writeFile,
  };
  return Object.freeze({
    view: policy.view,
    stat: (filePath) => operations.stat(filePath),
    readDirectory: (directoryPath) => operations.readdir(directoryPath, { withFileTypes: true }),
    readText: (filePath) => operations.readFile(filePath, "utf8"),
    async writeText(filePath, content) {
      await operations.mkdir(path.dirname(filePath), { recursive: true });
      await writeFileAtomic({
        filePath,
        content,
        writeFile: operations.writeFile,
        rename: operations.rename,
        remove: operations.rm,
        retryDelaysMs: atomicRenameRetryDelaysMs,
      });
    },
    async remove(filePath) {
      await operations.unlink(filePath);
    },
    async exists(filePath) {
      return Boolean(await operations.stat(filePath).catch(() => null));
    },
  });
}
