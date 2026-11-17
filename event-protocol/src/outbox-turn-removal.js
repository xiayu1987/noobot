/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { isPlainObject, isCanonicalText } from "@noobot/shared/value";

export function parseAuthorityOutboxTurnRemoval(source) {
  if (
    !isPlainObject(source) ||
    Object.keys(source).length !== 1 ||
    !Array.isArray(source.turnScopeIds) ||
    !source.turnScopeIds.length ||
    source.turnScopeIds.some((scope) => !isCanonicalText(scope)) ||
    new Set(source.turnScopeIds).size !== source.turnScopeIds.length
  )
    throw new TypeError("Outbox turn removal requires unique canonical turnScopeIds");
  return { turnScopeIds: [...source.turnScopeIds] };
}
