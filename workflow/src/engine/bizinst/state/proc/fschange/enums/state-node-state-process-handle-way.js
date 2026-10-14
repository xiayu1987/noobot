/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

const STATE_NODE_STATE_PROCESS_HANDLE_WAY_NAMES = Object.freeze({
  0: "start",
  1: "end",
  2: "open",
  3: "close",
  4: "forwardStateChange",
  5: "backwardStateChange",
  6: "takePartIn",
});

const STATE_NODE_STATE_PROCESS_HANDLE_WAY_DESCRIPTIONS = Object.freeze({
  0: "Start state.",
  1: "End state.",
  2: "Open state.",
  3: "Close state.",
  4: "Forward state change.",
  5: "Backward state change.",
  6: "Join state change (e.g. counted by a parallel join).",
});

var EStateNodeStateProcessHandleWay = {
  start: 0,
  end: 1,
  open: 2,
  close: 3,
  forwardStateChange: 4,
  backwardStateChange: 5,
  takePartIn: 6,
  getName(handleWay) {
    return STATE_NODE_STATE_PROCESS_HANDLE_WAY_NAMES[handleWay] || null;
  },
  getDescription(handleWay) {
    return STATE_NODE_STATE_PROCESS_HANDLE_WAY_DESCRIPTIONS[handleWay] || null;
  },
};

Object.defineProperty(EStateNodeStateProcessHandleWay, "NAMES", {
  value: STATE_NODE_STATE_PROCESS_HANDLE_WAY_NAMES,
  enumerable: false,
});
Object.defineProperty(EStateNodeStateProcessHandleWay, "DESCRIPTIONS", {
  value: STATE_NODE_STATE_PROCESS_HANDLE_WAY_DESCRIPTIONS,
  enumerable: false,
});

export default Object.freeze(EStateNodeStateProcessHandleWay);
