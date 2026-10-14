/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

import BizinstFlowEngine from "../../bizinstcontrolcenter/bizinst-flow-engine.js";
import ActionBase from "./action-base.js";

class StartAction extends ActionBase {
  constructor() {
    super("flow");
  }
  getName() {
    return "开始";
  }
  isStartAction() {
    return true;
  }
  exec(bizinst, stepState, flowListener) {
    BizinstFlowEngine.getInstance().startBizinst(bizinst, flowListener);
  }
}

export default StartAction;
