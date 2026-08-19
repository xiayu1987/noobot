/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { parse } from "@vue/compiler-sfc";

export function vueScriptRegions(filename, source) {
  const text = String(source ?? "");
  if (
    !String(filename || "")
      .toLowerCase()
      .endsWith(".vue")
  ) {
    return [{ source: text, offset: 0 }];
  }
  const { descriptor, errors } = parse(text, { filename: String(filename || "component.vue") });
  if (errors.length) {
    const message = errors
      .map((error) => (error instanceof Error ? error.message : String(error)))
      .join("; ");
    throw new SyntaxError(`Vue SFC parse failed: ${message}`);
  }
  return [descriptor.script, descriptor.scriptSetup]
    .filter(Boolean)
    .map((block) => ({ source: block.content, offset: block.loc.start.offset }));
}
