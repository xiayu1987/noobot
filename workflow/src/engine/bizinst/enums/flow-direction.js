/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

const FLOW_DIRECTION_NAMES = Object.freeze({
  0: "Backward",
  1: "Forward",
});

const FLOW_DIRECTION_DESCRIPTIONS = Object.freeze({
  0: "Backward: return along the path to a previous node or step.",
  1: "Forward: advance along the path to the next node or step.",
});

var EFlowDirection = {
  Backward: 0,
  Forward: 1,
  getName(direction) {
    return FLOW_DIRECTION_NAMES[direction] || null;
  },
  getDescription(direction) {
    return FLOW_DIRECTION_DESCRIPTIONS[direction] || null;
  },
};

Object.defineProperty(EFlowDirection, "NAMES", {
  value: FLOW_DIRECTION_NAMES,
  enumerable: false,
});
Object.defineProperty(EFlowDirection, "DESCRIPTIONS", {
  value: FLOW_DIRECTION_DESCRIPTIONS,
  enumerable: false,
});

export default Object.freeze(EFlowDirection);
