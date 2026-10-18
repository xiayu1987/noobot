/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

import WorkFlowContext from "../engine/work-flow-context.js";
import ContextRegister from "../engine/context-register.js";
import ModelBoxFactory from "../engine/bizinst/box/modelbox/model-box-factory.js";
import FlowtoBox from "../engine/bizinst/box/modelbox/flowto-box.js";
import { isObjectLike } from "@noobot/shared/value";

function registerModelBoxFactory(factory = null) {
  if (!isObjectLike(factory)) return false;
  ContextRegister.getInstance().regist(WorkFlowContext.MODELBOXFACTORYNAME, factory);
  return true;
}

export { ContextRegister, WorkFlowContext, ModelBoxFactory, FlowtoBox, registerModelBoxFactory };

export default {
  ContextRegister,
  WorkFlowContext,
  ModelBoxFactory,
  FlowtoBox,
  registerModelBoxFactory,
};
