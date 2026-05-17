/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 *
 * MCP module - backward-compatible re-exports.
 * Actual implementations are split into:
 *   - clients/streamable-http.js  (StreamableHttpMcpClient)
 *   - clients/sse.js              (SseMcpClient)
 *   - client-factory.js           (getMcpServerByName, createMcpClient)
 *   - tool-adapter.js             (buildMcpToolDescription, normalizeMcpToolResult, buildLangChainMcpTools)
 *   - task-runner.js              (createMcpAgentTools, executeMcpTask)
 */

// Client factory & server resolution
export { getMcpServerByName, createMcpClient } from "./client-factory.js";

// Tool adapter
export {
  buildMcpToolDescription,
  normalizeMcpToolResult,
  buildLangChainMcpTools,
} from "./tool-adapter.js";

// Task runner
export { createMcpAgentTools, executeMcpTask } from "./task-runner.js";

// Client classes (for direct use if needed)
export { StreamableHttpMcpClient } from "./clients/streamable-http.js";
export { SseMcpClient } from "./clients/sse.js";
