/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

import Model from "../design/model/model.js";
import Flowto from "../design/model/flowto/flowto.js";
import NodeLineRLAT from "../design/model/flowto/node-line-rlat.js";
import StateNode from "../design/model/node/state-node.js";
import ActionNode from "../design/model/node/action-node.js";
import ENodeType from "../design/model/node/enums/node-type.js";
import EStateType from "../design/model/node/enums/state-type.js";
import { text } from "@noobot/shared/value";

const SEMANTIC_NODE_TYPE = Object.freeze({ STATE: "state", ACTION: "action" });

function requireStateType(nodeDef) {
  const stateType = nodeDef?.stateType;
  if (!EStateType.isValid(stateType)) {
    throw new Error(`workflow state node ${text(nodeDef?.id)} has invalid stateType: ${stateType}`);
  }
  return stateType;
}

function requireNodeName(nodeDef) {
  const name = text(nodeDef?.name);
  if (!name) throw new Error(`workflow node ${text(nodeDef?.id)} requires name`);
  return name;
}

function createNode(nodeDef) {
  if (nodeDef?.type === SEMANTIC_NODE_TYPE.ACTION) {
    const node = new ActionNode();
    node.setNodeType(ENodeType.ActionNode);
    return node;
  }
  if (nodeDef?.type === SEMANTIC_NODE_TYPE.STATE) {
    const node = new StateNode();
    node.setNodeType(ENodeType.StateNode);
    node.setStateType(requireStateType(nodeDef));
    return node;
  }
  throw new Error(`workflow node ${text(nodeDef?.id)} has invalid type: ${nodeDef?.type}`);
}

function requireNode(nodeMap, nodeId) {
  const node = nodeMap.get(text(nodeId));
  if (!node) throw new Error(`workflow flowto references undefined node: ${text(nodeId)}`);
  return node;
}

export function compileWorkflowSemantic(semantic = {}) {
  const nodeDefs = Array.isArray(semantic?.nodes) ? semantic.nodes : [];
  const flowDefs = Array.isArray(semantic?.flowtos) ? semantic.flowtos : [];
  const model = new Model();
  const nodeMap = new Map();

  for (const nodeDef of nodeDefs) {
    const node = createNode(nodeDef);
    node.workflowNodeId = text(nodeDef?.id);
    node.setName(requireNodeName(nodeDef));
    node.setModel(model);
    nodeMap.set(text(nodeDef?.id), node);
  }

  const flowtos = [];
  const rlats = [];
  for (const [index, flowDef] of flowDefs.entries()) {
    const startNode = requireNode(nodeMap, flowDef?.from);
    const endNode = requireNode(nodeMap, flowDef?.to);

    const flowto = new Flowto();
    flowto.setName(text(flowDef?.name) || `flowto_${index + 1}`);
    if (typeof flowDef?.condition === "string" && flowDef.condition.trim()) {
      flowto.setCondition(flowDef.condition.trim());
    }
    flowto.setStartNode(startNode);
    flowto.setEndNode(endNode);
    flowtos.push(flowto);

    const startRLAT = new NodeLineRLAT();
    startRLAT.setNode(startNode);
    startRLAT.setFlowto(flowto);
    startRLAT.setRLATType(1);
    rlats.push(startRLAT);

    const endRLAT = new NodeLineRLAT();
    endRLAT.setNode(endNode);
    endRLAT.setFlowto(flowto);
    endRLAT.setRLATType(0);
    rlats.push(endRLAT);
  }

  model.setNodes(Array.from(nodeMap.values()));
  model.setFlowtos(flowtos);
  model.setNodeLineRLATs(rlats);
  return model;
}

export default {
  compileWorkflowSemantic,
};
