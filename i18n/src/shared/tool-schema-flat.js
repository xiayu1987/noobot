/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

export function buildToolSchemaFlat(schemaByTool) {
  const flat = {};
  for (const spec of Object.values(schemaByTool)) {
    if (spec.description) flat[spec.description.key] = spec.description.text;
    for (const paramSpec of Object.values(spec.params ?? {})) {
      flat[paramSpec.key] = paramSpec.text;
    }
    Object.assign(flat, spec.texts);
  }
  return flat;
}
