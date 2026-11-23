/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { isPlainObject } from "@noobot/shared/value";
import { QUANTITY_THRESHOLDS } from "@noobot/shared/quantity-thresholds";

export const CONTEXT_CANDIDATE_PAGE_SIZE = QUANTITY_THRESHOLDS.immutableStorage.messagePageSize;

export function requireContextCandidatePage({ turnScopeId, before, limit, limits }) {
  if (
    typeof turnScopeId !== "string" ||
    !turnScopeId.trim() ||
    !Number.isSafeInteger(before) ||
    before < 0 ||
    !Number.isSafeInteger(limit) ||
    limit < 1 ||
    limit > CONTEXT_CANDIDATE_PAGE_SIZE
  )
    throw new TypeError("Context candidate page requires bounded cursor and count");
  return createContextReadBudget(limits);
}

export const CONTEXT_READ_LIMITS = Object.freeze({
  dialogs: 256,
  turns: 4096,
  candidates: 8192,
  bytes: 16 * 1024 * 1024,
});

export const CONTEXT_BUDGET_ERROR = "SESSION_CONTEXT_READ_BUDGET_EXCEEDED";

export function createContextReadBudget(limits = CONTEXT_READ_LIMITS) {
  const dimensions = Object.keys(CONTEXT_READ_LIMITS);
  if (
    !isPlainObject(limits) ||
    Object.keys(limits).length !== dimensions.length ||
    dimensions.some(
      (dimension) =>
        !Number.isSafeInteger(limits[dimension]) ||
        limits[dimension] < 1 ||
        limits[dimension] > CONTEXT_READ_LIMITS[dimension],
    )
  )
    throw new TypeError("Context read requires explicit bounded work limits");
  const maximum = Object.freeze({ ...limits });
  const used = Object.fromEntries(dimensions.map((dimension) => [dimension, 0]));
  function assertAvailable(dimension, amount) {
    if (!Object.hasOwn(used, dimension) || !Number.isSafeInteger(amount) || amount < 0)
      throw new TypeError("Invalid context read work measurement");
    if (amount > maximum[dimension] - used[dimension])
      throw Object.assign(new Error(`Context read ${dimension} budget exceeded`), {
        code: CONTEXT_BUDGET_ERROR,
        dimension,
        limit: maximum[dimension],
        used: used[dimension],
        requested: amount,
      });
  }
  return Object.freeze({
    assertAvailable(dimension, amount = 1) {
      assertAvailable(dimension, amount);
    },
    consume(dimension, amount = 1) {
      assertAvailable(dimension, amount);
      used[dimension] += amount;
    },
  });
}
