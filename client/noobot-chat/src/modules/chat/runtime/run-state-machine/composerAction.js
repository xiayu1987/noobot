/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import {
  COMPOSER_PRIMARY_ACTION,
  COMPOSER_PRIMARY_ACTION_LABEL_KEY,
  TURN_TERMINAL_COMPOSER_PRIMARY_ACTION,
} from "./constants.js";
import { normalizeState } from "./normalize.js";

export function resolveComposerPrimaryAction(turnTerminal = "") {
  return (
    TURN_TERMINAL_COMPOSER_PRIMARY_ACTION[normalizeState(turnTerminal)] ||
    COMPOSER_PRIMARY_ACTION.SEND
  );
}

export function resolveComposerPrimaryActionLabelKey(primaryAction = "") {
  return COMPOSER_PRIMARY_ACTION_LABEL_KEY[normalizeState(primaryAction)] || "";
}

export { COMPOSER_PRIMARY_ACTION };
