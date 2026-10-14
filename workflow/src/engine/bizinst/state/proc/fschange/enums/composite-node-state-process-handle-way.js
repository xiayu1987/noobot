/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

const COMPOSITE_NODE_STATE_PROCESS_HANDLE_WAY_NAMES = Object.freeze({
  0: "startChildBizinst",
  1: "openChildBizinst",
  2: "noticeParentBizinst",
});

const COMPOSITE_NODE_STATE_PROCESS_HANDLE_WAY_DESCRIPTIONS = Object.freeze({
  0: "Start child instance.",
  1: "Open child instance.",
  2: "Child instance notifies parent instance.",
});

var ECompositeNodeStateProcessHandleWay = {
  startChildBizinst: 0,
  openChildBizinst: 1,
  noticeParentBizinst: 2,
  getName(handleWay) {
    return COMPOSITE_NODE_STATE_PROCESS_HANDLE_WAY_NAMES[handleWay] || null;
  },
  getDescription(handleWay) {
    return COMPOSITE_NODE_STATE_PROCESS_HANDLE_WAY_DESCRIPTIONS[handleWay] || null;
  },
};

Object.defineProperty(ECompositeNodeStateProcessHandleWay, "NAMES", {
  value: COMPOSITE_NODE_STATE_PROCESS_HANDLE_WAY_NAMES,
  enumerable: false,
});
Object.defineProperty(ECompositeNodeStateProcessHandleWay, "DESCRIPTIONS", {
  value: COMPOSITE_NODE_STATE_PROCESS_HANDLE_WAY_DESCRIPTIONS,
  enumerable: false,
});

export default Object.freeze(ECompositeNodeStateProcessHandleWay);
