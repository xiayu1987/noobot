/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { DynamicStructuredTool } from "@langchain/core/tools";
import { z } from "zod";
import { toToolJsonResult } from "../core/tool-json-result.js";
import { tTool } from "../core/tool-i18n.js";
import { TOOL_NAME, TOOL_RESULT_STATE } from "../constants/index.js";
import { getRuntimeFromAgentContext } from "../../context/agent-context-accessor.js";

export function createWaitTool(ctx = {}) {
  const runtime = getRuntimeFromAgentContext(ctx?.agentContext || {});
  const waitTool = new DynamicStructuredTool({
    name: TOOL_NAME.WAIT,
    description: tTool(runtime, "tools.wait.description"),
    schema: z.object({
      waitMs: z.number().describe(tTool(runtime, "tools.wait.fieldWaitMs")),
    }),
    func: async ({ waitMs }) => {
      const MAX_WAIT_MS = 1 * 60 * 1000;
      const requestedWaitMs = Number(waitMs) || 0;
      const actualWaitMs = Math.min(Math.max(requestedWaitMs, 0), MAX_WAIT_MS);
      await new Promise((resolve) => setTimeout(resolve, actualWaitMs));
      return toToolJsonResult(TOOL_NAME.WAIT, {
        ok: true,
        state: TOOL_RESULT_STATE.OK,
        requested_wait_ms: requestedWaitMs,
        actual_wait_ms: actualWaitMs,
        capped: requestedWaitMs > MAX_WAIT_MS,
      });
    },
  });
  return [waitTool];
}
