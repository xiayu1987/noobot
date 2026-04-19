/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { DynamicStructuredTool } from "@langchain/core/tools";
import { z } from "zod";
import { assertAndResolveUserWorkspaceFilePath } from "./check-tool-input.js";
import { toToolJsonResult } from "./tool-json-result.js";

export function createFileTool({ agentContext }) {
  const readFileTool = new DynamicStructuredTool({
    name: "read_file",
    description: "读取文本文件（仅允许用户工作区内路径）",
    schema: z.object({
      filePath: z.string().describe("要读取的文件路径（工作区相对路径或用户目录内绝对路径）"),
    }),
    func: async ({ filePath }) => {
      const resolvedPath = await assertAndResolveUserWorkspaceFilePath({
        filePath,
        agentContext,
        fieldName: "filePath",
        mustExist: true,
      });
      const content = await readFile(resolvedPath, "utf8");
      return toToolJsonResult("read_file", {
        ok: true,
        resolvedPath,
        fileName: path.basename(resolvedPath),
        content,
      });
    },
  });

  const writeFileTool = new DynamicStructuredTool({
    name: "write_file",
    description: "写入文件（仅允许用户工作区内路径）",
    schema: z.object({
      filePath: z.string().describe("要写入的文件路径（工作区相对路径或用户目录内绝对路径）"),
      content: z.string().describe("写入文件的文本内容"),
    }),
    func: async ({ filePath, content }) => {
      const resolvedPath = await assertAndResolveUserWorkspaceFilePath({
        filePath,
        agentContext,
        fieldName: "filePath",
      });
      await mkdir(path.dirname(resolvedPath), { recursive: true });
      await writeFile(resolvedPath, content, "utf8");
      return toToolJsonResult("write_file", {
        ok: true,
        state: "OK",
        resolvedPath,
        fileName: path.basename(resolvedPath),
      });
    },
  });

  return [readFileTool, writeFileTool];
}
