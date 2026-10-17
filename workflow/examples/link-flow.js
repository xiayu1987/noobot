/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

import Flowto from "../src/design/model/flowto/flowto.js";
import NodeLineRLAT from "../src/design/model/flowto/node-line-rlat.js";

export function linkFlow(flowName, fromNode, toNode) {
  const flow = new Flowto();
  flow.setName(flowName);
  flow.setStartNode(fromNode);
  flow.setEndNode(toNode);

  const fromRLAT = new NodeLineRLAT();
  fromRLAT.setNode(fromNode);
  fromRLAT.setFlowto(flow);
  fromRLAT.setRLATType(1);

  const toRLAT = new NodeLineRLAT();
  toRLAT.setNode(toNode);
  toRLAT.setFlowto(flow);
  toRLAT.setRLATType(0);

  return { flow, fromRLAT, toRLAT };
}
