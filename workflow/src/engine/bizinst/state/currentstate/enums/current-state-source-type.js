/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

const CURRENT_STATE_SOURCE_TYPE_NAMES = Object.freeze({
  0: "currentBizinst",
  1: "childBizinst",
});

const CURRENT_STATE_SOURCE_TYPE_DESCRIPTIONS = Object.freeze({
  0: "State source triggered by the current instance.",
  1: "State source triggered by a child instance callback.",
});

var ECurrentStateSourceType = {
  currentBizinst: 0,
  childBizinst: 1,
  getName(sourceType) {
    return CURRENT_STATE_SOURCE_TYPE_NAMES[sourceType] || null;
  },
  getDescription(sourceType) {
    return CURRENT_STATE_SOURCE_TYPE_DESCRIPTIONS[sourceType] || null;
  },
};

Object.defineProperty(ECurrentStateSourceType, "NAMES", {
  value: CURRENT_STATE_SOURCE_TYPE_NAMES,
  enumerable: false,
});
Object.defineProperty(ECurrentStateSourceType, "DESCRIPTIONS", {
  value: CURRENT_STATE_SOURCE_TYPE_DESCRIPTIONS,
  enumerable: false,
});

export default Object.freeze(ECurrentStateSourceType);
