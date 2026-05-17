/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { DynamicStructuredTool } from "@langchain/core/tools";
import { z } from "zod";
import { toToolJsonResult } from "../core/tool-json-result.js";
import { tTool } from "../core/tool-i18n.js";
import { TOOL_NAME, TOOL_RESULT_STATUS } from "../constants/index.js";

export const FINAL_ANSWER_TOOL_NAME = TOOL_NAME.FINAL_ANSWER;

export function createFinalAnswerTool(ctx = {}) {
  const runtime = ctx?.agentContext?.runtime || {};
  const finalAnswerTool = new DynamicStructuredTool({
    name: FINAL_ANSWER_TOOL_NAME,
    description: tTool(runtime, "tools.final_answer.description"),
    schema: z
      .object({
        reason: z
          .string()
          .optional()
          .describe(tTool(runtime, "tools.final_answer.fieldReason")),
      }),
    func: async () =>
      toToolJsonResult(FINAL_ANSWER_TOOL_NAME, {
        ok: true,
        status: TOOL_RESULT_STATUS.FINALIZE,
        message: tTool(runtime, "tools.final_answer.finalizeMessage"),
      }),
  });
  return [finalAnswerTool];
}
