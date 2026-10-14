/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

import BizinstFlowEngine from "../../bizinstcontrolcenter/bizinst-flow-engine.js";
import ActionBase from "./action-base.js";

class StopAction extends ActionBase {
  constructor() {
    super("flow");
  }
  getName() {
    return "stop";
  }
  exec(bizinst, stepState, flowListener) {
    BizinstFlowEngine.getInstance().stopBizinst(bizinst, stepState, flowListener);
  }
}

export default StopAction;
