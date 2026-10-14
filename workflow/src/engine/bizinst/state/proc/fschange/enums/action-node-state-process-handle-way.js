/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

const ACTION_NODE_STATE_PROCESS_HANDLE_WAY_NAMES = Object.freeze({
  0: "Arrive",
  1: "Handle",
  2: "Stop",
});

const ACTION_NODE_STATE_PROCESS_HANDLE_WAY_DESCRIPTIONS = Object.freeze({
  0: "Arrive at step.",
  1: "Handle step.",
  2: "Stop step.",
});

var EActionNodeStateProcessHandleWay = {
  Arrive: 0,
  Handle: 1,
  Stop: 2,
  getName(handleWay) {
    return ACTION_NODE_STATE_PROCESS_HANDLE_WAY_NAMES[handleWay] || null;
  },
  getDescription(handleWay) {
    return ACTION_NODE_STATE_PROCESS_HANDLE_WAY_DESCRIPTIONS[handleWay] || null;
  },
};

Object.defineProperty(EActionNodeStateProcessHandleWay, "NAMES", {
  value: ACTION_NODE_STATE_PROCESS_HANDLE_WAY_NAMES,
  enumerable: false,
});
Object.defineProperty(EActionNodeStateProcessHandleWay, "DESCRIPTIONS", {
  value: ACTION_NODE_STATE_PROCESS_HANDLE_WAY_DESCRIPTIONS,
  enumerable: false,
});

export default Object.freeze(EActionNodeStateProcessHandleWay);
