/* Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { diagnoseToolBindingConfig } from "@noobot/model-protocol";
import { diagnoseConfigModelReferences } from "./model-reference.js";

import { createConfigIssue } from "./issues.js";

export function diagnoseConfigDocument(document, options = {}) {
  return Object.freeze([
    ...diagnoseConfigModelReferences(document, options),
    ...diagnoseToolBindingConfig(document.tools?.bindings).map(({ code, ...details }) =>
      createConfigIssue(code, details),
    ),
  ]);
}
