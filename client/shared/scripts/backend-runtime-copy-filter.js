/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { clientFilePath as path } from "../path-resolver.js";

const ignoredRuntimePath =
  /(^|[/\\])(?:node_modules|\.git|\.pm2|__tests__|test|tests|\.cache|dist|coverage)([/\\]|$)|\.(?:map|md)$/i;
const privateConfigFileNames = new Set([
  "global.config.json",
  "config.json",
  "agent-proxy.config.json",
  "model-proxy.config.json",
]);

export function shouldCopyBackendRuntimeFile(fromRoot, sourcePath) {
  const relativePath = path.relative(fromRoot, sourcePath);
  const normalizedRelativePath = relativePath.split(path.sep).join("/");
  if (normalizedRelativePath.startsWith("src/prompts/")) return true;
  if (ignoredRuntimePath.test(relativePath)) return false;
  return !privateConfigFileNames.has(path.basename(sourcePath));
}
