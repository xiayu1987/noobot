/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

const FLOW_DIRECTION_NAMES = Object.freeze({
  0: 'Backward',
  1: 'Forward',
});

const FLOW_DIRECTION_DESCRIPTIONS = Object.freeze({
  0: '反向流转：沿路径回退到前置节点/步骤。',
  1: '正向流转：沿路径推进到后续节点/步骤。',
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

Object.defineProperty(EFlowDirection, 'NAMES', {
  value: FLOW_DIRECTION_NAMES,
  enumerable: false,
});
Object.defineProperty(EFlowDirection, 'DESCRIPTIONS', {
  value: FLOW_DIRECTION_DESCRIPTIONS,
  enumerable: false,
});

module.exports = Object.freeze(EFlowDirection);
