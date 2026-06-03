/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

import IFlowto from '../../../../../design/model/flowto/interfaces/flowto.js';
import IBizinst from '../../../interfaces/bizinst.js';
import IFlowtoState from '../../../state/modelstate/interfaces/flowto-state.js';
import IBizinstModel from '../../../state/modelstate/interfaces/bizinst-model.js';

class IFlowtoBox {
  setFlowto(flowto) {}
  getFlowto() {}
  createFlowtoState(bizinstModel) {}
  canFlow(bizinst) {}
}

export default  IFlowtoBox;
