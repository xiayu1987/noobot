/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { normalizeKnownConfigKeys } from "../normalization/keys.js";
import { sanitizeScenarioConfig } from "./scenario-policy.js";
import { isPlainObject } from "../utils.js";
import {
  CONFIG_DOCUMENT_SCOPE,
  CONFIG_NODE_ACCESS,
  CONFIG_PATH_REPRESENTATION,
} from "../contract/repair.js";
import { projectConfigDocumentForAccess } from "../contract/config-structure.js";

export function sanitizeUserConfig(input = {}) {
  const src = normalizeKnownConfigKeys(isPlainObject(input) ? input : {});
  const out = projectConfigDocumentForAccess(src, {
    scope: CONFIG_DOCUMENT_SCOPE.USER,
    access: CONFIG_NODE_ACCESS.USER,
    representation: CONFIG_PATH_REPRESENTATION.RUNTIME,
  });
  if (isPlainObject(out.scenarios)) {
    const scenarios = sanitizeScenarioConfig(out.scenarios);
    if (Object.keys(scenarios).length) out.scenarios = scenarios;
    else delete out.scenarios;
  }
  return out;
}
