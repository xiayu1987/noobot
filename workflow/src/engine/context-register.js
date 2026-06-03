/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

var ModelBoxFactory = require('./bizinst/box/modelbox/model-box-factory');
var ModelStateBoxFactory = require('./bizinst/box/modelstatebox/model-state-box-factory');
var WorkFlowContext = require('./work-flow-context');

class ContextRegister {
  constructor() {}
  static getInstance() {
    if (!ContextRegister.instance) ContextRegister.instance = new ContextRegister();
    return ContextRegister.instance;
  }
  regist(id, contextBean) {
    WorkFlowContext.getInstance().addContextBean(id, contextBean);
  }
}
ContextRegister.instance = new ContextRegister();
ContextRegister.instance.regist(WorkFlowContext.MODELBOXFACTORYNAME, ModelBoxFactory.getInstance());
ContextRegister.instance.regist(WorkFlowContext.MODELSTATEBOXFACTORYNAME, ModelStateBoxFactory.getInstance());

module.exports = ContextRegister;
