/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { DynamicStructuredTool } from "@langchain/core/tools";
import { z } from "zod";
import {
  assertAndResolveUserWorkspaceFilePath,
  assertValidFileNameFromPath,
} from "./check-tool-input.js";
import { toToolJsonResult } from "./tool-json-result.js";
import { tTool } from "./tool-i18n.js";

export function createFileTool({ agentContext }) {
  const readFileTool = new DynamicStructuredTool({
    name: "read_file",
    description: tTool(agentContext, "tools.file.readDescription"),
    schema: z.object({
      filePath: z.string().describe(tTool(agentContext, "tools.file.readFilePathField")),
    }),
    func: async ({ filePath }) => {
      assertValidFileNameFromPath({ filePath, fieldName: "filePath" });
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
    description: tTool(agentContext, "tools.file.writeDescription"),
    schema: z.object({
      filePath: z.string().describe(tTool(agentContext, "tools.file.writeFilePathField")),
      content: z.string().describe(tTool(agentContext, "tools.file.writeContentField")),
    }),
    func: async ({ filePath, content }) => {
      assertValidFileNameFromPath({ filePath, fieldName: "filePath" });
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
