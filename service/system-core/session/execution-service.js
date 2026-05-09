/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 *
 * Backward-compatible re-export.
 * Actual implementation moved to ../tracking/execution-log/execution-log-service.js
 * This file re-exports as ExecutionService for backward compatibility.
 */
import { ExecutionLogService } from "../tracking/execution-log/execution-log-service.js";

// Alias for backward compatibility
export const ExecutionService = ExecutionLogService;
