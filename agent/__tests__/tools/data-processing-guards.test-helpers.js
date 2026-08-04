/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import fs from "node:fs/promises";
import { createTestAgentExecutionScope } from "../helpers/agent-execution-scope.js";

export function buildAgentContext(basePath = "", runtime = {}, options = {}) {
  return createTestAgentExecutionScope({
    basePath,
    globalConfig: {},
    userConfig: {},
    sharedTools: {},
    ...runtime,
  }, options);
}

export async function readJsonl(filePath) {
  const content = await fs.readFile(filePath, "utf8");
  return content.trim().split("\n").filter(Boolean).map((line) => JSON.parse(line));
}
