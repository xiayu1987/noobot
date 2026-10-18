/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { createRuntimeContext } from "../../src/runtime/runtime-context-factory.js";

export function createTestRuntimeContext(options = {}) {
  return createRuntimeContext({ abortSignal: new AbortController().signal, ...options });
}
