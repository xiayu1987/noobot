/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

import {
  startWorkflowInstanceById,
  getWorkflowInstanceSnapshot as getWorkflowInstanceSnapshotById,
  advanceWorkflowInstanceById,
  releaseWorkflowInstance as releaseWorkflowInstanceById,
} from "workflow";
import { parseWorkflowDslText } from "../protocol/text-protocol.js";
import { WORKFLOW_PLUGIN_DEFAULTS } from "../core/constants.js";
import { mountWorkflowExtensions } from "../extensions/workflow/runtime.js";

export function executeWorkflowText({ semanticText = "", options = {} } = {}) {
  const semantic = parseWorkflowDslText(semanticText);
  return { semantic };
}

function normalizeRoutingStatesForRuntime(semantic = {}) {
  const nodes = Array.isArray(semantic?.nodes) ? semantic.nodes : [];
  const flowtos = Array.isArray(semantic?.flowtos) ? semantic.flowtos : [];
  const nodeById = new Map(
    nodes
      .map((node) => [String(node?.id || "").trim(), node])
      .filter(([id]) => id),
  );
  const branchIds = new Set(
    nodes
      .filter(
        (node) =>
          String(node?.type || "").trim().toLowerCase() === "state" &&
          Number(node?.stateType) === 2 &&
          String(node?.id || "").trim() !== "start",
      )
      .map((node) => String(node?.id || "").trim())
      .filter(Boolean),
  );
  if (!branchIds.size) return semantic;

  const incomingByBranchId = new Map();
  const outgoingByBranchId = new Map();
  for (const flowto of flowtos) {
    const from = String(flowto?.from || "").trim();
    const to = String(flowto?.to || "").trim();
    if (branchIds.has(to)) {
      const list = incomingByBranchId.get(to) || [];
      list.push(flowto);
      incomingByBranchId.set(to, list);
    }
    if (branchIds.has(from)) {
      const list = outgoingByBranchId.get(from) || [];
      list.push(flowto);
      outgoingByBranchId.set(from, list);
    }
  }

  const runtimeFlowtos = flowtos.filter(
    (flowto) =>
      !branchIds.has(String(flowto?.from || "").trim()) &&
      !branchIds.has(String(flowto?.to || "").trim()),
  );
  for (const branchId of branchIds) {
    const incoming = incomingByBranchId.get(branchId) || [];
    const outgoing = outgoingByBranchId.get(branchId) || [];
    if (!incoming.length || !outgoing.length) continue;
    for (const incomingFlow of incoming) {
      for (const outgoingFlow of outgoing) {
        runtimeFlowtos.push({
          from: String(incomingFlow?.from || "").trim(),
          to: String(outgoingFlow?.to || "").trim(),
          name: `${String(incomingFlow?.from || "").trim()}->${String(outgoingFlow?.to || "").trim()}#${branchId}`,
        });
      }
    }
  }

  const runtimeNodes = nodes
    .filter((node) => !branchIds.has(String(node?.id || "").trim()))
    .map((node) => ({ ...node }));
  const outgoingCount = new Map();
  for (const flowto of runtimeFlowtos) {
    const from = String(flowto?.from || "").trim();
    if (!from) continue;
    outgoingCount.set(from, Number(outgoingCount.get(from) || 0) + 1);
  }
  for (const node of runtimeNodes) {
    const id = String(node?.id || "").trim();
    if (
      String(node?.type || "").trim().toLowerCase() === "state" &&
      Number(outgoingCount.get(id) || 0) > 1 &&
      Number(node?.stateType) === 0
    ) {
      node.stateType = 2;
    }
  }
  return {
    ...semantic,
    nodes: runtimeNodes.filter((node) => nodeById.has(String(node?.id || "").trim())),
    flowtos: runtimeFlowtos,
  };
}

export function createWorkflowInstance({ instanceId = "", semantic = {}, options = {}, meta = {} } = {}) {
  mountWorkflowExtensions({ options, meta });
  const runtimeSemantic = normalizeRoutingStatesForRuntime(semantic);
  return startWorkflowInstanceById({
    instanceId,
    semantic: runtimeSemantic,
    options: {
      maxAutoTransitions:
        Number.isFinite(Number(options?.maxAutoTransitions)) && Number(options.maxAutoTransitions) > 0
          ? Math.floor(Number(options.maxAutoTransitions))
          : WORKFLOW_PLUGIN_DEFAULTS.DEFAULT_MAX_AUTO_TRANSITIONS,
    },
    meta,
  });
}

export function getWorkflowInstanceSnapshot({ instanceId = "" } = {}) {
  return getWorkflowInstanceSnapshotById({ instanceId });
}

export function advanceWorkflowInstance({ instanceId = "", action = { type: "submit", stepIndex: 0 } } = {}) {
  return advanceWorkflowInstanceById({ instanceId, action });
}

export function releaseWorkflowInstance({ instanceId = "" } = {}) {
  return releaseWorkflowInstanceById({ instanceId });
}
