/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

const MODEL_STATE_TYPE_NAMES = Object.freeze({
  0: "StateNodeState",
  1: "CompositeNodeState",
  2: "ActionNodeState",
  3: "StepState",
  4: "FlowtoState",
});

const MODEL_STATE_TYPE_DESCRIPTIONS = Object.freeze({
  0: "State node instance state.",
  1: "Composite node (child process) instance state.",
  2: "Action node instance state.",
  3: "Step state under an action node.",
  4: "Flowto instance state.",
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

Object.defineProperty(EModelStateType, "NAMES", {
  value: MODEL_STATE_TYPE_NAMES,
  enumerable: false,
});
Object.defineProperty(EModelStateType, "DESCRIPTIONS", {
  value: MODEL_STATE_TYPE_DESCRIPTIONS,
  enumerable: false,
});

export default Object.freeze(EModelStateType);
