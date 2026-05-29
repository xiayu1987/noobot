/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { HARNESS_ENGINEERING_CAPABILITIES } from "../profile.js";
import { createAcceptanceHandler } from "./acceptance/index.js";
import { createGuidanceHandler } from "./guidance/index.js";
import { createPlanningHandler } from "./planning/index.js";
import { createReviewHandler } from "./review/index.js";
import { shouldProcessPrimaryToolHooks } from "./shared/index.js";

function createNoopHandler(capability = "") {
  return async ({ point = "" } = {}) => ({
    capability,
    point,
    implemented: false,
    status: "planned",
  });
}

export function createDefaultCapabilityHandlers() {
  const fallback = HARNESS_ENGINEERING_CAPABILITIES.reduce((acc, capability) => {
    acc[capability] = createNoopHandler(capability);
    return acc;
  }, {});

  fallback.planning = createPlanningHandler({ shouldProcessPrimaryToolHooks });
  fallback.guidance = createGuidanceHandler({ shouldProcessPrimaryToolHooks });
  fallback.acceptance = createAcceptanceHandler({ shouldProcessPrimaryToolHooks });
  fallback.review = createReviewHandler();

  return fallback;
}

export function resolveCapabilityHandlers(handlers = {}) {
  const incoming = handlers && typeof handlers === "object" ? handlers : {};
  const fallback = createDefaultCapabilityHandlers();
  return HARNESS_ENGINEERING_CAPABILITIES.reduce((acc, capability) => {
    const candidate = incoming[capability];
    acc[capability] = typeof candidate === "function" ? candidate : fallback[capability];
    return acc;
  }, {});
}
