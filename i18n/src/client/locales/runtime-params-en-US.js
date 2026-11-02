/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import time from "./runtime-params-en-US-time.js";
import turn from "./runtime-params-en-US-turn.js";
import quantity from "./runtime-params-en-US-quantity.js";
import length from "./runtime-params-en-US-length.js";
import modules from "./runtime-params-en-US-modules.js";

export const runtimeParamsEnUS = {
  title: "Runtime parameters",
  activation:
    "Saved changes take effect after restarting the service and related runtime components. Reload the page after restart.",
  pending: "Saved revision {saved}; service revision {active}. Restart required.",
  search: "Search parameter names, keys and descriptions",
  reload: "Reload",
  restoreAll: "Restore all defaults",
  restore: "Default",
  save: "Save {count} changes",
  saved: "Saved. Restart related runtime components to activate.",
  changes: "Changes to save",
  default: "Default",
  active: "Service active value",
  categories: { time: "Time", turn: "Turns", quantity: "Quantity", length: "Length and capacity" },
  allParameters: "All parameters",
  noMatch: "No matching parameters",
  units: {
    bytes: "Bytes",
    characters: "Characters",
    milliseconds: "Milliseconds",
    seconds: "Seconds",
    days: "Days",
    pixels: "Pixels",
    count: "Count",
  },
  fixed: {
    cryptography: "Fixed cryptographic constraint",
    presentation: "Fixed presentation metric",
    bootstrap: "Read before the service and workspace are ready, so the snapshot cannot apply",
    crossProcess:
      "Contract value shared by several processes; changing one side breaks consistency",
    protocol: "Fixed protocol constraint",
  },
  errors: {
    INVALID_RUNTIME_PARAMS: "The parameter document must be an object.",
    UNKNOWN_RUNTIME_PARAM: "An unknown or read-only parameter was submitted.",
    INVALID_RUNTIME_PARAM_VALUE: "A value must be an integer within the displayed range.",
    INVALID_RUNTIME_PARAM_RELATION: "The minimum or default exceeds its associated maximum.",
    INVALID_RUNTIME_PARAMS_REVISION: "A valid saved revision is required.",
    RUNTIME_PARAMS_CONFLICT:
      "Another administrator changed these parameters. Reload before saving.",
    RUNTIME_PARAMS_BUSY: "Another save is in progress. Retry after it finishes.",
    RUNTIME_PARAMS_LOCK_CORRUPTED:
      "The parameter store lock is invalid. Ask an operator to inspect the lock file.",
    INVALID_RUNTIME_PARAMS_DOCUMENT:
      "The saved parameter document has an invalid version or fields.",
    RUNTIME_PARAMS_ACTOR_REQUIRED: "An authenticated administrator is required.",
  },
  modules,
  parameters: { time, turn, quantity, length },
};
