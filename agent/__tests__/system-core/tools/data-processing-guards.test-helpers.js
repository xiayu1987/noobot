/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import fs from "node:fs/promises";

export function buildAgentContext(basePath = "") {
  return {
    environment: {
      workspace: { basePath },
    },
    execution: {
      controllers: {
        runtime: {
          basePath,
          globalConfig: {},
          userConfig: {},
          sharedTools: {},
        },
      },
    },
  };
}

export async function readJsonl(filePath) {
  const content = await fs.readFile(filePath, "utf8");
  return content.trim().split("\n").filter(Boolean).map((line) => JSON.parse(line));
}
