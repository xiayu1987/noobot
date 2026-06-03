/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

const STOP_REASON_NAMES = Object.freeze({
  0: 'actionStop',
  1: 'childStop',
});

const STOP_REASON_DESCRIPTIONS = Object.freeze({
  0: '由动作节点主动终止。',
  1: '由子流程终止后传递导致。',
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

Object.defineProperty(EStopReason, 'NAMES', {
  value: STOP_REASON_NAMES,
  enumerable: false,
});
Object.defineProperty(EStopReason, 'DESCRIPTIONS', {
  value: STOP_REASON_DESCRIPTIONS,
  enumerable: false,
});

export default  Object.freeze(EStopReason);
