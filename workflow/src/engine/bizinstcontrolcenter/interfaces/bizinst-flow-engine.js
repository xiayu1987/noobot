/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

class IBizinstFlowEngine {
  createBizinst(business, model) {}
  startBizinst(bizinst, flowListener) {}
  openBizinst(bizinst, flowListener) {}
  stopBizinst(bizinst, currentStepState, flowListener) {}
  goNext(bizinst, currentStepState, flowListener) {}
  goPre(bizinst, currentStepState, flowListener) {}
}

export default IBizinstFlowEngine;
