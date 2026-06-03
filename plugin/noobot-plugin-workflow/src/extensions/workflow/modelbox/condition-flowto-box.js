/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

import { evaluateFlowCondition } from "../condition-evaluator.js";

export function createConditionFlowtoBox(BaseFlowtoBox) {
  return class ConditionFlowtoBox extends BaseFlowtoBox {
    canFlow(bizinst) {
      const flowto = this.getFlowto();
      const condition = String(flowto?.getCondition?.() || flowto?.condition || "").trim();
      if (!condition) return true;
      return evaluateFlowCondition(condition, bizinst);
    }
  };
}

