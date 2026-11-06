/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

import { text } from "@noobot/shared/value";
import { resolveToolBindingName, requireResponseToolNameBindings } from "@noobot/model-protocol";

export function containsExecutableScriptText(value = "", bindings) {
  const content = text(value);
  if (!content) return false;
  requireResponseToolNameBindings({ toolNameBindings: bindings });
  const scriptName = resolveToolBindingName("execute_script", bindings);
  return [
    /```(?:bash|sh|shell|zsh|cmd|powershell)\b[\s\S]*?```/i,
    new RegExp(
      `(?<![a-zA-Z0-9_-])${scriptName}(?![a-zA-Z0-9_-])[\\s\\S]*(?:command|riskLevel|executionMode)`,
      "i",
    ),
    /(^|\n)\s*(?:sudo\s+)?(?:rm\s+-rf|chmod\s+\+x|curl\s+[^\n|]+\s*\|\s*(?:sh|bash)|npm\s+(?:run|install)|git\s+(?:reset|clean)|docker\s+(?:rm|stop|exec))\b/im,
  ].some((pattern) => pattern.test(content));
}
