/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

const STATE_TYPE_NAMES = Object.freeze({
  0: "Start",
  1: "End",
  2: "Branch",
  3: "Merge",
});

const STATE_TYPE_DESCRIPTIONS = Object.freeze({
  0: "Start node: the single entry of a process.",
  1: "End node: the single exit of a process.",
  2: "Branch node: splits the flow into parallel paths.",
  3: "Merge node: joins parallel paths after all of them arrive.",
});

var EStateType = {
  Start: 0,
  End: 1,
  Branch: 2,
  Merge: 3,
  getName(stateType) {
    return STATE_TYPE_NAMES[stateType] || null;
  },
  getDescription(stateType) {
    return STATE_TYPE_DESCRIPTIONS[stateType] || null;
  },
  isValid(stateType) {
    return Number.isInteger(stateType) && Object.hasOwn(STATE_TYPE_NAMES, stateType);
  },
};

Object.defineProperty(EStateType, "NAMES", {
  value: STATE_TYPE_NAMES,
  enumerable: false,
});
Object.defineProperty(EStateType, "DESCRIPTIONS", {
  value: STATE_TYPE_DESCRIPTIONS,
  enumerable: false,
});

export default Object.freeze(EStateType);
