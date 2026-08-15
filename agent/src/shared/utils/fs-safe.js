/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { filePath as path, isPathWithinRoot } from "@noobot/path-resolver";
import { recoverableToolError } from "../errors/index.js";
import { tSystem } from "noobot-i18n/agent/system-text";
import { ERROR_CODE } from "../errors/constants.js";

export function safeJoin(base, target) {
  const resolvedBase = path.resolve(base);
  const resolvedTarget = path.resolve(base, target);
  if (!isPathWithinRoot(resolvedBase, resolvedTarget)) {
    throw recoverableToolError(`${tSystem("common.pathOutOfScope")}: ${target}`, {
      code: ERROR_CODE.RECOVERABLE_PATH_OUT_OF_SCOPE,
      details: { base: resolvedBase, target },
    });
  }
  return resolvedTarget;
}
