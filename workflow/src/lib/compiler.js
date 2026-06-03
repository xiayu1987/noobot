/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

const Model = require("../design/model/model");
const Flowto = require("../design/model/flowto/flowto");
const NodeLineRLAT = require("../design/model/flowto/node-line-rlat");
const StateNode = require("../design/model/node/state-node");
const ActionNode = require("../design/model/node/action-node");
const ENodeType = require("../design/model/node/enums/node-type");

function toStateType(value = "") {
  const key = String(value || "").trim().toLowerCase();
  if (key === "start") return 0;
  if (key === "end") return 1;
  if (key === "branch") return 2;
  if (key === "merge") return 3;
  if (key === "normal") return 0;
  const numeric = Number(value);
  if (Number.isFinite(numeric) && numeric >= 0) return Math.floor(numeric);
  return 0;
}

function ensureNodeDefinitions(input = {}) {
  const nodes = Array.isArray(input?.nodes) ? input.nodes.slice() : [];
  const byId = new Map(nodes.map((node) => [String(node.id || "").trim(), node]));
  if (!byId.has("start")) {
    nodes.unshift({ id: "start", name: "开始", type: "state", stateType: 0 });
    byId.set("start", nodes[0]);
  }
  if (!byId.has("end")) {
    nodes.push({ id: "end", name: "结束", type: "state", stateType: 1 });
    byId.set("end", nodes[nodes.length - 1]);
  }
  let flowtos = Array.isArray(input?.flowtos) ? input.flowtos.slice() : [];
  if (!flowtos.length) {
    flowtos = [{ from: "start", to: "end", name: "开始到结束" }];
  }
  return { nodes, flowtos };
}

function compileWorkflowSemantic(semantic = {}) {
  const { nodes: nodeDefs, flowtos: flowDefs } = ensureNodeDefinitions(semantic);
  const model = new Model();
  const nodeMap = new Map();

  for (const nodeDef of nodeDefs) {
    const isAction = String(nodeDef?.type || "state").trim().toLowerCase() === "action";
    const node = isAction ? new ActionNode() : new StateNode();
    node.setName(String(nodeDef?.name || nodeDef?.id || "节点").trim());
    node.setNodeType(isAction ? ENodeType.ActionNode : ENodeType.StateNode);
    if (!isAction) {
      node.setStateType(toStateType(nodeDef?.stateType));
    }
    node.setModel(model);
    nodeMap.set(String(nodeDef?.id || "").trim(), node);
  }

  const flowtos = [];
  const rlats = [];
  for (const [index, flowDef] of flowDefs.entries()) {
    const startNode = nodeMap.get(String(flowDef?.from || "").trim());
    const endNode = nodeMap.get(String(flowDef?.to || "").trim());
    if (!startNode || !endNode) continue;

    const flowto = new Flowto();
    flowto.setName(String(flowDef?.name || `流向${index + 1}`).trim());
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

module.exports = {
  compileWorkflowSemantic,
};
