/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { DynamicStructuredTool } from "@langchain/core/tools";
import { z } from "zod";
import { toToolJsonResult } from "./tool-json-result.js";
import { tTool } from "./tool-i18n.js";

export function createWaitTool(ctx = {}) {
  const runtime = ctx?.agentContext?.runtime || {};
  const waitTool = new DynamicStructuredTool({
    name: "wait",
    description: tTool(runtime, "tools.wait.description"),
    schema: z.object({
      waitMs: z.number().describe(tTool(runtime, "tools.wait.fieldWaitMs")),
    }),
    func: async ({ waitMs }) => {
      const MAX_WAIT_MS = 1 * 60 * 1000;
      const requestedWaitMs = Number(waitMs) || 0;
      const actualWaitMs = Math.min(Math.max(requestedWaitMs, 0), MAX_WAIT_MS);
      await new Promise((resolve) => setTimeout(resolve, actualWaitMs));
      return toToolJsonResult("wait", {
        ok: true,
        state: "OK",
        requested_wait_ms: requestedWaitMs,
        actual_wait_ms: actualWaitMs,
        capped: requestedWaitMs > MAX_WAIT_MS,
      });
    },
  });
  return [waitTool];
}
