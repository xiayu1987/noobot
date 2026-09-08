/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

import WorkFlowContext from "../../../work-flow-context.js";
import ActionNodeState from "../../state/modelstate/action-node-state.js";
import ModelStateBoxFactory from "../modelstatebox/model-state-box-factory.js";
import NodeBoxBase from "./node-box-base.js";

class ActionNodeBox extends NodeBoxBase {
  constructor() {
    super();
  }
  createNodeState(bizinstModel) {
    const result = new ActionNodeState();
    result.setNode(this.getNode());
    result.setBizinstModel(bizinstModel);
    const modelStateBoxFactory =
      WorkFlowContext.getInstance().getContextBean(WorkFlowContext.MODELSTATEBOXFACTORYNAME) ||
      ModelStateBoxFactory.getInstance();
    const actionNodeStateBox = modelStateBoxFactory.getActionNodeStateBox(result);
    const stepStates = [];
    stepStates.push(actionNodeStateBox.createStepState());
    result.setStepStates(stepStates);
    return result;
  }
}

export default ActionNodeBox;
