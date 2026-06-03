/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

const MODEL_STATE_TYPE_NAMES = Object.freeze({
  0: 'StateNodeState',
  1: 'CompositeNodeState',
  2: 'ActionNodeState',
  3: 'StepState',
  4: 'FlowtoState',
});

const MODEL_STATE_TYPE_DESCRIPTIONS = Object.freeze({
  0: '状态节点实例状态。',
  1: '复合节点（子流程）实例状态。',
  2: '动作节点实例状态。',
  3: '动作节点下的步骤状态。',
  4: '流转连线实例状态。',
});

var EModelStateType = {
  StateNodeState: 0,
  CompositeNodeState: 1,
  ActionNodeState: 2,
  StepState: 3,
  FlowtoState: 4,
  getName(modelStateType) {
    return MODEL_STATE_TYPE_NAMES[modelStateType] || null;
  },
  getDescription(modelStateType) {
    return MODEL_STATE_TYPE_DESCRIPTIONS[modelStateType] || null;
  },
};

Object.defineProperty(EModelStateType, 'NAMES', {
  value: MODEL_STATE_TYPE_NAMES,
  enumerable: false,
});
Object.defineProperty(EModelStateType, 'DESCRIPTIONS', {
  value: MODEL_STATE_TYPE_DESCRIPTIONS,
  enumerable: false,
});

export default  Object.freeze(EModelStateType);
