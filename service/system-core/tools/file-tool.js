/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { access, readFile, writeFile } from "node:fs/promises";
import { DynamicStructuredTool } from "@langchain/core/tools";
import { z } from "zod";

export function createFileTool({ agentContext }) {
  const readFileTool = new DynamicStructuredTool({
    name: "read_file",
    description: "读取文本文件,可直接读取的文件",
    schema: z.object({
      path: z.string().describe("要读取的文件路径（绝对路径或工作区内路径）"),
    }),
    func: async ({ path }) => {
      try {
        await access(path);
      } catch {
        return "File not found";
      }
      return readFile(path, "utf8");
    },
  });

  const writeFileTool = new DynamicStructuredTool({
    name: "write_file",
    description: "写入文件",
    schema: z.object({
      path: z.string().describe("要写入的文件路径（绝对路径或工作区内路径）"),
      content: z.string().describe("写入文件的文本内容"),
    }),
    func: async ({ path, content }) => {
      await writeFile(path, content, "utf8");
      return `OK: ${path}`;
    },
  });

  return [readFileTool, writeFileTool];
}
