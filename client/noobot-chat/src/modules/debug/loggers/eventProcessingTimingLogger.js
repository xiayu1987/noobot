/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

import { createDiagnosticsLogger } from "./createDiagnosticsLogger.js";

const logger = createDiagnosticsLogger("event-processing-timing");
export const setEventProcessingTimingLogSink = logger.setSink;
export const isEventProcessingTimingEnabled = logger.isEnabled;
export const logEventProcessingTiming = logger.log;
