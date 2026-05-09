/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 *
 * Backward-compatible re-export.
 * Actual implementation moved to ../../tracking/execution-log/execution-log-repository.js
 * This file re-exports as FileSystemExecutionRepository for backward compatibility.
 */
import { ExecutionLogRepository } from "../../tracking/execution-log/execution-log-repository.js";

// Alias for backward compatibility
export const FileSystemExecutionRepository = ExecutionLogRepository;
