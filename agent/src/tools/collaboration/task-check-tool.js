/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { DynamicStructuredTool } from "@langchain/core/tools";
import { z } from "zod";
import { TASK_STATUS } from "../../bot/async/constants.js";
import { getRuntimeFromAgentContext } from "../../context/agent-context-accessor.js";
import { ERROR_CODE } from "../../shared/errors/constants.js";
import { recoverableToolError } from "../../shared/errors/index.js";
import { TOOL_NAME } from "../constants/index.js";
import { toToolJsonResult } from "../core/tool-json-result.js";
import { tTool } from "../core/tool-i18n.js";
import {
  TASK_CHECK_PROTOCOL_VERSION,
  createTaskCheckReceipt,
  parseTaskCheckContent,
} from "@noobot/context-protocol/task-check-protocol";

export const TASK_CHECK_TOOL_NAME = TOOL_NAME.TASK_CHECK;

export function createTaskCheckTool(ctx = {}) {
  const runtime = getRuntimeFromAgentContext(ctx?.agentContext || {});
  const systemRuntime = runtime?.systemRuntime || {};

  return [new DynamicStructuredTool({
    name: TASK_CHECK_TOOL_NAME,
    description: tTool(runtime, "tools.task_check.description"),
    schema: z.object({
      checkContent: z.string().describe(tTool(runtime, "tools.task_check.fieldCheckContent")),
    }),
    func: async ({ checkContent }) => {
      const content = String(checkContent || "").trim();
      if (!content) {
        throw recoverableToolError(
          tTool(runtime, "tools.task_check.checkContentRequired"),
          { code: ERROR_CODE.RECOVERABLE_INPUT_MISSING },
        );
      }
      let parsed;
      try {
        parsed = parseTaskCheckContent(content);
      } catch (error) {
        throw recoverableToolError(
          tTool(runtime, "tools.task_check.checkProtocolInvalid"),
          {
            code: ERROR_CODE.RECOVERABLE_INVALID_TOOL_INPUT,
            details: { reason: String(error?.message || error) },
          },
        );
      }
      systemRuntime.taskCheckLoopCount = 0;
      return toToolJsonResult(TASK_CHECK_TOOL_NAME, {
        ok: true,
        status: TASK_STATUS.COMPLETED,
        protocolVersion: TASK_CHECK_PROTOCOL_VERSION,
        summary: createTaskCheckReceipt(parsed),
        message: tTool(runtime, "tools.task_check.completed"),
      }, true);
    },
  })];
}
