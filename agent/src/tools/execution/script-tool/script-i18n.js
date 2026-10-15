/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { tTool } from "../../core/tool-i18n.js";
import { text } from "@noobot/shared/value";

export function tScript(runtime = {}, key = "", params = {}) {
  return tTool(runtime, `tools.script.${text(key)}`, params);
}
