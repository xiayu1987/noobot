/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import assert from "node:assert/strict";
import test from "node:test";
import {
  CONTEXT_READ_LIMITS,
  CONTEXT_BUDGET_ERROR,
  createContextReadBudget,
} from "../src/context-read-budget.js";

for (const dimension of Object.keys(CONTEXT_READ_LIMITS)) {
  test(`context ${dimension} work is shared, bounded and rejects before consumption`, () => {
    const limits = { ...CONTEXT_READ_LIMITS, [dimension]: 3 };
    const budget = createContextReadBudget(limits);
    limits[dimension] = 99;
    budget.assertAvailable(dimension, 3);
    budget.assertAvailable(dimension, 3);
    budget.consume(dimension, 2);
    assert.throws(() => budget.assertAvailable(dimension, 2), {
      code: CONTEXT_BUDGET_ERROR,
      dimension,
      limit: 3,
      used: 2,
      requested: 2,
    });
    assert.throws(() => budget.consume(dimension, 2), {
      code: CONTEXT_BUDGET_ERROR,
      dimension,
      limit: 3,
      used: 2,
      requested: 2,
    });
    budget.consume(dimension);
    assert.throws(() => budget.consume(dimension), { used: 3 });
  });
}

test("context limits reject incomplete, unknown and unbounded dimensions", () => {
  for (const limits of [
    null,
    {},
    { ...CONTEXT_READ_LIMITS, unknown: 1 },
    { ...CONTEXT_READ_LIMITS, bytes: Infinity },
    { ...CONTEXT_READ_LIMITS, turns: 0 },
    { ...CONTEXT_READ_LIMITS, dialogs: 1.5 },
    { ...CONTEXT_READ_LIMITS, candidates: CONTEXT_READ_LIMITS.candidates + 1 },
  ])
    assert.throws(() => createContextReadBudget(limits), TypeError);
  const budget = createContextReadBudget();
  for (const [dimension, amount] of [
    ["unknown", 1],
    ["bytes", -1],
    ["bytes", Infinity],
  ]) {
    assert.throws(() => budget.consume(dimension, amount), TypeError);
    assert.throws(() => budget.assertAvailable(dimension, amount), TypeError);
  }
});
