/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

import { createConditionFlowtoBox } from "./condition-flowto-box.js";

export function createConditionModelBoxFactory(BaseModelBoxFactory, BaseFlowtoBox) {
  const ConditionFlowtoBox = createConditionFlowtoBox(BaseFlowtoBox);
  return class ConditionModelBoxFactory extends BaseModelBoxFactory {
    getFlowtoBox(flowto) {
      const result = new ConditionFlowtoBox();
      result.setFlowto(flowto);
      return result;
    }
  };
}

