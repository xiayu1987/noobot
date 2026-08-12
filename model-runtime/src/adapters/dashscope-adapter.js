/* Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import {
  bindOpenAiCompatibleTools,
  createOpenAiCompatibleClient,
  resolveUseResponsesApi,
} from "./openai-compatible-adapter.js";
import { classifyTransportError } from "../policies/default-retry-policy.js";
import { executeOpenAiOperation } from "./openai-capability-adapter.js";

export function createDashScopeClient(input = {}) {
  const modelSpec = input.modelSpec || {};
  const headers = {
    ...(input.headers || {}),
    ...(resolveUseResponsesApi(modelSpec) ? { "x-dashscope-session-cache": "enable" } : {}),
  };
  return createOpenAiCompatibleClient({ ...input, headers });
}

export const dashscopeAdapter = Object.freeze({
  id: "dashscope",
  formats: Object.freeze(["dashscope"]),
  classifyError: classifyTransportError,
  createClient(input) {
    return createDashScopeClient(input);
  },
  bindTools({ client, tools, toolOptions, invokeOptions }) {
    return bindOpenAiCompatibleTools(client, tools, toolOptions, invokeOptions);
  },
  executeOperation(input) {
    return executeOpenAiOperation(input);
  },
});
