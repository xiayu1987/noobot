/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { DynamicStructuredTool } from "@langchain/core/tools";
import { z } from "zod";
import {
  assertAndResolveUserWorkspaceFilePath,
  assertValidFileNameFromPath,
} from "../core/check-tool-input.js";
import { toToolJsonResult } from "../core/tool-json-result.js";
import { tTool } from "../core/tool-i18n.js";
import { TOOL_NAME, TOOL_RESULT_STATE } from "../constants/index.js";

const MAX_FILE_CONTENT_CHARS = 8000;
const MAX_FILE_CONTENT_BYTES_PRECHECK = 20000;

export function createFileTool({ agentContext }) {
  const readFileTool = new DynamicStructuredTool({
    name: TOOL_NAME.READ_FILE,
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
      const fileStat = await stat(resolvedPath);
      if (Number(fileStat?.size || 0) > MAX_FILE_CONTENT_BYTES_PRECHECK) {
        return toToolJsonResult(TOOL_NAME.READ_FILE, {
          ok: false,
          message: tTool(agentContext, "tools.file.readContentTooLong"),
          resolvedPath,
          fileName: path.basename(resolvedPath),
        });
      }
      const content = await readFile(resolvedPath, "utf8");
      if (content.length > MAX_FILE_CONTENT_CHARS) {
        return toToolJsonResult(TOOL_NAME.READ_FILE, {
          ok: false,
          message: tTool(agentContext, "tools.file.readContentTooLong"),
          resolvedPath,
          fileName: path.basename(resolvedPath),
        });
      }
      return toToolJsonResult(TOOL_NAME.READ_FILE, {
        ok: true,
        resolvedPath,
        fileName: path.basename(resolvedPath),
        content,
      });
    },
  });

  const writeFileTool = new DynamicStructuredTool({
    name: TOOL_NAME.WRITE_FILE,
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
      if (String(content || "").length > MAX_FILE_CONTENT_CHARS) {
        return toToolJsonResult(TOOL_NAME.WRITE_FILE, {
          ok: false,
          message: tTool(agentContext, "tools.file.writeContentTooLong"),
          resolvedPath,
          fileName: path.basename(resolvedPath),
        });
      }
      await mkdir(path.dirname(resolvedPath), { recursive: true });
      await writeFile(resolvedPath, content, "utf8");
      return toToolJsonResult(TOOL_NAME.WRITE_FILE, {
        ok: true,
        state: TOOL_RESULT_STATE.OK,
        resolvedPath,
        fileName: path.basename(resolvedPath),
      });
    },
  });

  return [readFileTool, writeFileTool];
}
