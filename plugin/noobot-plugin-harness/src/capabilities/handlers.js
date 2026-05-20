import { HARNESS_ENGINEERING_CAPABILITIES } from "./profile.js";
import { createAcceptanceHandler } from "./handlers/acceptance.js";
import { createGuidanceHandler } from "./handlers/guidance.js";
import { createPlanningHandler } from "./handlers/planning.js";
import { createReviewHandler } from "./handlers/review.js";
import { shouldProcessPrimaryToolHooks } from "./handlers/shared.js";

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
