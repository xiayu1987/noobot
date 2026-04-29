/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { DynamicStructuredTool } from "@langchain/core/tools";
import { z } from "zod";
import { toToolJsonResult } from "./tool-json-result.js";

export function createWaitTool() {
  const waitTool = new DynamicStructuredTool({
    name: "wait",
    description: "同步等待指定毫秒后返回（最大 1 分钟）",
    schema: z.object({
      waitMs: z.number().describe("等待时间（毫秒）"),
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

