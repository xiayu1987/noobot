/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

import WorkFlowContext from '../work-flow-context.js';
import BizinstBox from '../bizinst/box/bizinstbox/bizinst-box.js';
import ModelBoxFactory from '../bizinst/box/modelbox/model-box-factory.js';
import ModelStateBoxFactory from '../bizinst/box/modelstatebox/model-state-box-factory.js';
import ENodeType from '../../design/model/node/enums/node-type.js';
import CantFlowException from '../exception/cant-flow-exception.js';
import FlowPolicyException from '../exception/flow-policy-exception.js';

class BizinstFlowEngine {
  static instance = new BizinstFlowEngine();

  static getInstance() {
    return BizinstFlowEngine.instance;
  }

  createBizinst(business, model) {
    return BizinstBox.createBizinst(business, model);
  }

  startBizinst(bizinst, flowListener) {
    if (!bizinst || !flowListener) return;
    const stateNodeBox = this.getStartNodeBox(bizinst.getModel());
    if (!stateNodeBox) return;
    const stateNodeState = stateNodeBox.createNodeState(bizinst.getState().getBizinstModel());
    this._startBizinstWithState(bizinst, stateNodeState, flowListener);
  }

  openBizinst(bizinst, flowListener) {
    if (!bizinst || !flowListener) return;
    const stateNodeStates = bizinst.getState().getCurrentState().getStateNodeStates() || [];
    for (const stateNodeState of stateNodeStates) {
      this._goPreFromNodeState(bizinst, stateNodeState, flowListener);
    }
    const source = bizinst.getState().getCurrentState().getSourceInfo?.()?.getModelState?.();
    if (source) flowListener.open(bizinst, source);
  }

  stopBizinst(bizinst, currentStepState, flowListener) {
    if (!bizinst || !currentStepState || !flowListener) return;
    flowListener.stop(bizinst, currentStepState);
  }

  goNext(bizinst, currentStepState, flowListener) {
    if (!bizinst || !currentStepState || !flowListener) return;
    const stepStateBox = this.getModelStateBoxFactory().getStepStateBox(currentStepState);
    const currentActionNodeState = currentStepState.getActionNodeState();
    const nextStepState = stepStateBox.getNextStepState();
    if (nextStepState) {
      flowListener.arriveStepState(bizinst, nextStepState);
    } else {
      this._goNextFromNodeState(bizinst, currentActionNodeState, flowListener);
    }
    flowListener.handleStepState(bizinst, currentStepState);
  }

  goPre(bizinst, currentStepState, flowListener) {
    if (!bizinst || !currentStepState || !flowListener) return;
    const stepStateBox = this.getModelStateBoxFactory().getStepStateBox(currentStepState);
    const currentActionNodeState = currentStepState.getActionNodeState();
    const currentActionNodeStateBox = this.getModelStateBoxFactory().getActionNodeStateBox(currentActionNodeState);
    const preStepState = stepStateBox.getPreStepState();

    if (!preStepState) {
      const toThisPathState = currentActionNodeStateBox.getToThisPathState?.();
      if (toThisPathState) this._goPreFromPathState(bizinst, toThisPathState, flowListener);
    } else {
      flowListener.arriveStepState(bizinst, preStepState);
    }
    flowListener.handleStepState(bizinst, currentStepState);
  }

  _startBizinstWithState(bizinst, stateNodeState, flowListener) {
    if (!bizinst || !stateNodeState || !flowListener) return;
    flowListener.discoverModelState(bizinst, stateNodeState);
    this._goNextFromNodeState(bizinst, stateNodeState, flowListener);
    flowListener.start(bizinst, stateNodeState);
  }

  _goNextFromNodeState(bizinst, currentNodeState, flowListener) {
    if (!bizinst || !currentNodeState || !flowListener) return;
    const currentNodeStateBox = this.getNodeStateBox(currentNodeState);
    if (!currentNodeStateBox || !currentNodeStateBox.getNodeStartFlowtos) return;
    const flowtos = currentNodeStateBox.getNodeStartFlowtos() || [];

    let canFlowtoCount = 0;
    for (const flowto of flowtos) {
      const flowtoBox = this.getModelBoxFactory().getFlowtoBox(flowto);
      if (flowtoBox.canFlow && !flowtoBox.canFlow(bizinst)) continue;
      canFlowtoCount++;

      const currentNode = currentNodeState.getNode?.();
      const currentStateType = currentNode?.getStateType?.();
      if (!(currentStateType === 2) && canFlowtoCount > 1) {
        throw new FlowPolicyException('存在多个符合条件的流向。');
      }

      const flowtoState = flowtoBox.createFlowtoState(bizinst.getState().getBizinstModel());
      flowListener.discoverModelState(bizinst, flowtoState);

      const flowtoStateBox = this.getModelStateBoxFactory().getFlowtoStateBox(flowtoState);
      const endNode = flowtoStateBox.getFlowtoState().getFlowto().getEndNode();

      const nodeType = endNode?.getNodeType?.();
      const isActionNode = nodeType === ENodeType.ActionNode || typeof endNode?.getStepCount === 'function';
      const isCompositeNode = nodeType === ENodeType.CompositeNode || typeof endNode?.getSubModel === 'function';

      if (isActionNode) {
        const nextActionNodeState = this.getModelBoxFactory().getActionNodeBox(endNode).createNodeState(bizinst.getState().getBizinstModel());
        const nextActionNodeStateBox = this.getModelStateBoxFactory().getActionNodeStateBox(nextActionNodeState);
        const pathState = flowtoStateBox.createPathState(bizinst.getState().getBizinstModel(), currentNodeState, nextActionNodeState);
        flowListener.discoverModelState(bizinst, nextActionNodeState);
        flowListener.goThrough(bizinst, pathState, 1);
        flowListener.arriveStepState(bizinst, nextActionNodeStateBox.getFirstStepState());
        continue;
      }

      if (isCompositeNode) {
        const nextCompositeNodeState = this.getModelBoxFactory().getCompositeNodeBox(endNode).createNodeState(bizinst.getState().getBizinstModel());
        const pathState = flowtoStateBox.createPathState(bizinst.getState().getBizinstModel(), currentNodeState, nextCompositeNodeState);
        flowListener.discoverModelState(bizinst, nextCompositeNodeState);
        flowListener.goThrough(bizinst, pathState, 1);
        flowListener.startChildBizinst(bizinst, nextCompositeNodeState);
        this.startBizinst(nextCompositeNodeState.getBizinst(), flowListener);
        continue;
      }

      const nextStateNodeState = this.getModelBoxFactory().getStateNodeBox(endNode).createNodeState(bizinst.getState().getBizinstModel());
      const pathState = flowtoStateBox.createPathState(bizinst.getState().getBizinstModel(), currentNodeState, nextStateNodeState);
      const nextStateNodeStateBox = this.getModelStateBoxFactory().getStateNodeStateBox(nextStateNodeState);

      flowListener.discoverModelState(bizinst, nextStateNodeState);
      flowListener.goThrough(bizinst, pathState, 1);
      flowListener.takePartInStateChange(bizinst, nextStateNodeState);

      if (nextStateNodeStateBox.canForwardChange(bizinst)) {
        const stateType = nextStateNodeState.getNode().getStateType();
        if (stateType === 1 || stateType === 3) {
          flowListener.end(bizinst, nextStateNodeState);
        } else {
          flowListener.forwardStateNodeStateChange(bizinst, nextStateNodeState);
        }
      }
      continue;
    }
    if (canFlowtoCount === 0) {
      throw new CantFlowException('不存在符合条件的流向。');
    }
  }

  _goPreFromNodeState(bizinst, currentNodeState, flowListener) {
    const currentNodeStateBox = this.getNodeStateBox(currentNodeState);
    const toThisPathState = currentNodeStateBox?.getToThisPathState?.();
    if (toThisPathState) this._goPreFromPathState(bizinst, toThisPathState, flowListener);
  }

  _goPreFromPathState(bizinst, pathState, flowListener) {
    const preNodeState = pathState.getStartNodeState();
    flowListener.goThrough(bizinst, pathState, 0);

    if (preNodeState && typeof preNodeState.getStepStates === 'function') {
      const preActionNodeStateBox = this.getModelStateBoxFactory().getActionNodeStateBox(preNodeState);
      flowListener.arriveStepState(bizinst, preActionNodeStateBox.getLastStepState());
      return;
    }
    if (preNodeState && typeof preNodeState.getBizinst === 'function') {
      flowListener.openChildBizinst(bizinst, preNodeState);
      this.openBizinst(preNodeState.getBizinst(), flowListener);
      return;
    }
    const preStateNodeStateBox = this.getModelStateBoxFactory().getStateNodeStateBox(preNodeState);
    if (preStateNodeStateBox.canBackwardChange(bizinst)) {
      const stateType = preNodeState.getNode().getStateType();
      if (stateType === 0 || stateType === 2) {
        flowListener.close(bizinst, preNodeState);
      } else {
        flowListener.backwardStateNodeStateChange(bizinst, preNodeState);
      }
    }
  }

  getNodeStateBox(nodeState) {
    const factory = this.getModelStateBoxFactory();
    if (nodeState && typeof nodeState.getStepStates === 'function') return factory.getActionNodeStateBox(nodeState);
    if (nodeState && typeof nodeState.getBizinst === 'function') return factory.getCompositeNodeStateBox(nodeState);
    return factory.getStateNodeStateBox(nodeState);
  }

  getStartNodeBox(model) {
    const modelBox = this.getModelBoxFactory().getModelBox(model);
    const stateNode = modelBox.getStartNode();
    return this.getModelBoxFactory().getStateNodeBox(stateNode);
  }

  getEndNodeBox(model) {
    const modelBox = this.getModelBoxFactory().getModelBox(model);
    const stateNode = modelBox.getEndNode();
    return this.getModelBoxFactory().getStateNodeBox(stateNode);
  }

  getModelStateBoxFactory() {
    return WorkFlowContext.getInstance().getContextBean(WorkFlowContext.MODELSTATEBOXFACTORYNAME) || ModelStateBoxFactory.getInstance();
  }

  getModelBoxFactory() {
    return WorkFlowContext.getInstance().getContextBean(WorkFlowContext.MODELBOXFACTORYNAME) || ModelBoxFactory.getInstance();
  }
}

export default  BizinstFlowEngine;
