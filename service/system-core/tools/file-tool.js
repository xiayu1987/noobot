/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { DynamicStructuredTool } from "@langchain/core/tools";
import { z } from "zod";

export function createFileTool({ agentContext }) {
  const readFileTool = new DynamicStructuredTool({
    name: "read_file",
    description: "读取文本文件,可直接读取的文件",
    schema: z.object({ path: z.string() }),
    func: async ({ path }) => {
      if (!existsSync(path)) return "File not found";
      return readFileSync(path, "utf8");
    },
  });

  const writeFileTool = new DynamicStructuredTool({
    name: "write_file",
    description: "写入文件",
    schema: z.object({ path: z.string(), content: z.string() }),
    func: async ({ path, content }) => {
      writeFileSync(path, content, "utf8");
      return `OK: ${path}`;
    },
  });

  return [readFileTool, writeFileTool];
}
