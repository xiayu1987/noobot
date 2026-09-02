/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

import { createDiagnosticsLogger } from "./createDiagnosticsLogger.js";

const logger = createDiagnosticsLogger("message-mutation-diagnostics");
export const setMessageMutationDiagnosticsLogSink = logger.setSink;
export const logMessageMutationDiagnostics = logger.log;
