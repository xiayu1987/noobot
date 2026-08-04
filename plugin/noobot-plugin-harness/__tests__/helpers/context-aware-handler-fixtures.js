/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

import { createAcceptanceHandler as createAcceptanceHandlerImpl } from "../../src/capabilities/handlers/acceptance.js";
import { createGuidanceHandler as createGuidanceHandlerImpl } from "../../src/capabilities/handlers/guidance.js";
import { createPlanningHandler as createPlanningHandlerImpl } from "../../src/capabilities/handlers/planning.js";
import {
  createTestResolveModelMessages,
  ensureTestHookContext,
} from "./public-runtime-fixtures.js";

const resolveModelMessages = createTestResolveModelMessages();

function ensureTestHandlerMeta(input = {}) {
  const meta = input.meta && typeof input.meta === "object" ? input.meta : (input.meta = {});
  const harness = meta.harness && typeof meta.harness === "object"
    ? meta.harness
    : (meta.harness = {});
  if (typeof harness.resolveModelMessages !== "function") {
    harness.resolveModelMessages = resolveModelMessages;
  }
}

function wrapFactory(factory) {
  return (...args) => {
    const handler = factory(...args);
    return (input = {}) => {
      ensureTestHookContext(input.ctx || (input.ctx = {}));
      ensureTestHandlerMeta(input);
      return handler(input);
    };
  };
}

export const createAcceptanceHandler = wrapFactory(createAcceptanceHandlerImpl);
export const createGuidanceHandler = wrapFactory(createGuidanceHandlerImpl);
export const createPlanningHandler = wrapFactory(createPlanningHandlerImpl);
