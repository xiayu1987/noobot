/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
const ENTRY_PAIR_LENGTH = 2;

function isEntryValuePattern(elements) {
  return elements.length === ENTRY_PAIR_LENGTH && elements[0] === null && elements[1] !== null;
}

function positionalHoleIndexes(elements) {
  if (isEntryValuePattern(elements)) return [];
  return elements.flatMap((element, index) => (element === null ? [index] : []));
}

const noPositionalPatternHoles = {
  meta: {
    type: "problem",
    schema: [],
    messages: {
      positionalHole:
        "array destructuring skips position {{index}}; use a named object protocol or named capture groups",
    },
  },
  create(context) {
    return {
      ArrayPattern(node) {
        for (const index of positionalHoleIndexes(node.elements)) {
          context.report({ node, messageId: "positionalHole", data: { index } });
        }
      },
    };
  },
};

export const noobotLocalRules = Object.freeze({
  rules: { "no-positional-pattern-holes": noPositionalPatternHoles },
});
