/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 *
 * Event module — public API barrel.
 *
 * Sub-modules:
 *   - emitter.js            (emitEvent)
 *   - execution-listener.js (createExecutionEventListener)
 *   - llm-filter.js         (createLlmDeltaVisibilityFilter)
 *   - log-normalizer.js     (classifyExecutionEvent, normalizeSseLogEvent)
 */

export { emitEvent } from "./emitter.js";
export { setEventAdapter, getEventAdapter } from "./adapter.js";
export { createExecutionEventListener } from "./execution-listener.js";
export { createLlmDeltaVisibilityFilter } from "./llm-filter.js";
export { classifyExecutionEvent, normalizeSseLogEvent } from "./log-normalizer.js";
