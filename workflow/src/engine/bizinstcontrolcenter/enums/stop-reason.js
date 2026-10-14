/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

const STOP_REASON_NAMES = Object.freeze({
  0: "actionStop",
  1: "childStop",
});

const STOP_REASON_DESCRIPTIONS = Object.freeze({
  0: "Stopped by an action node.",
  1: "Propagated from a stopped child process.",
});

var EStopReason = {
  actionStop: 0,
  childStop: 1,
  getName(stopReason) {
    return STOP_REASON_NAMES[stopReason] || null;
  },
  getDescription(stopReason) {
    return STOP_REASON_DESCRIPTIONS[stopReason] || null;
  },
};

Object.defineProperty(EStopReason, "NAMES", {
  value: STOP_REASON_NAMES,
  enumerable: false,
});
Object.defineProperty(EStopReason, "DESCRIPTIONS", {
  value: STOP_REASON_DESCRIPTIONS,
  enumerable: false,
});

export default Object.freeze(EStopReason);
