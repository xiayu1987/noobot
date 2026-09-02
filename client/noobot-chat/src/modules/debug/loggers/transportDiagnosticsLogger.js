/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

import { createDiagnosticsLogger } from "./createDiagnosticsLogger.js";

const logger = createDiagnosticsLogger("transport-diagnostics");
export const setTransportDiagnosticsLogSink = logger.setSink;
export const logTransportDiagnostics = logger.log;
