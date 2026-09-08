/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

import BizinstBox from "../bizinstbox/bizinst-box.js";
import CompositeNodeState from "../../state/modelstate/composite-node-state.js";
import NodeBoxBase from "./node-box-base.js";

class CompositeNodeBox extends NodeBoxBase {
  constructor() {
    super();
  }
  createNodeState(bizinstModel) {
    const result = new CompositeNodeState();
    result.setNode(this.getNode());
    result.setBizinstModel(bizinstModel);
    const childBizinst = BizinstBox.createBizinst(result, this.getNode());
    childBizinst.setParentBizinst(bizinstModel.getState().getBizinst());
    result.setBizinst(childBizinst);
    return result;
  }
}

export default CompositeNodeBox;
