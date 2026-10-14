/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

const NODE_TYPE_NAMES = Object.freeze({
  0: "StateNode",
  1: "CompositeNode",
  2: "ActionNode",
});

const NODE_TYPE_DESCRIPTIONS = Object.freeze({
  0: "State node: routes start, end, fork and join.",
  1: "Composite node: hosts and starts a child process.",
  2: "Action node: hosts business actions such as approval.",
});

var ENodeType = {
  StateNode: 0,
  CompositeNode: 1,
  ActionNode: 2,
  getName(nodeType) {
    return NODE_TYPE_NAMES[nodeType] || null;
  },
  getDescription(nodeType) {
    return NODE_TYPE_DESCRIPTIONS[nodeType] || null;
  },
};

Object.defineProperty(ENodeType, "NAMES", {
  value: NODE_TYPE_NAMES,
  enumerable: false,
});
Object.defineProperty(ENodeType, "DESCRIPTIONS", {
  value: NODE_TYPE_DESCRIPTIONS,
  enumerable: false,
});

export default Object.freeze(ENodeType);
