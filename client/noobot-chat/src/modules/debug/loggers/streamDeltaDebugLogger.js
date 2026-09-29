/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

import { createDiagnosticsLogger } from "./createDiagnosticsLogger.js";

// Per-chunk diagnostics for live-only (transient) message deltas; gated by the
// server-issued `stream-delta` session-log debug policy.
const logger = createDiagnosticsLogger("stream-delta");
export const setStreamDeltaDebugLogSink = logger.setSink;
export const logStreamDeltaDebug = logger.log;
