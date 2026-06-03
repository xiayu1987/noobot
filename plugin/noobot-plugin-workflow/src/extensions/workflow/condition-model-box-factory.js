/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

import { createConditionModelBoxFactory } from "./modelbox/condition-model-box-factory.js";
import { getWorkflowExtensionApi } from "./extension-api.js";

let mounted = false;

export function mountConditionModelBoxFactory() {
  if (mounted) return;
  const { ModelBoxFactory: BaseModelBoxFactory, FlowtoBox: BaseFlowtoBox, registerModelBoxFactory } =
    getWorkflowExtensionApi();
  const ConditionModelBoxFactory = createConditionModelBoxFactory(
    BaseModelBoxFactory,
    BaseFlowtoBox,
  );

  registerModelBoxFactory(new ConditionModelBoxFactory());
  mounted = true;
}
