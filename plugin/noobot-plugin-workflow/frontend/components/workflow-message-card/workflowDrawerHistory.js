/*
  Copyright (c) 2026 xiayu
  Contact: 126240622+xiayu1987@users.noreply.github.com
  SPDX-License-Identifier: MIT
*/

import { resolveWorkflowDialogProcessId } from "./workflowDialogProcessIdCompat.js";

const PSEUDO_ROUTE_PANEL_KEY = "panel";
const PSEUDO_ROUTE_WORKFLOW_PANEL = "workflow-node-session";
const PSEUDO_ROUTE_WORKFLOW_DIALOG_PROCESS_KEY = "workflowDialogProcessId";
const PSEUDO_ROUTE_WORKFLOW_ROOT_KEY = "workflowRootSessionId";

export function buildWorkflowDrawerRoute(nodeItem = {}, workflowPayload = {}, patch = {}) {
  const dialogProcessId = String(
    Object.prototype.hasOwnProperty.call(patch, "dialogProcessId")
      ? patch.dialogProcessId
      : resolveWorkflowDialogProcessId(nodeItem),
  ).trim();
  const rootSessionId = String(
    Object.prototype.hasOwnProperty.call(patch, "rootSessionId")
      ? patch.rootSessionId
      : nodeItem?.rootSessionId ||
          workflowPayload?.planningDialog?.sessionId ||
          workflowPayload?.runMeta?.sessionId ||
          "",
  ).trim();
  return { dialogProcessId, rootSessionId };
}

export function writeWorkflowDrawerHistory(route = {}, { mode = "replace" } = {}) {
  const dialogProcessId = String(route?.dialogProcessId || "").trim();
  const rootSessionId = String(route?.rootSessionId || "").trim();
  const params = new URLSearchParams(window.location.search || "");
  if (dialogProcessId && rootSessionId) {
    params.set(PSEUDO_ROUTE_PANEL_KEY, PSEUDO_ROUTE_WORKFLOW_PANEL);
    params.set(PSEUDO_ROUTE_WORKFLOW_DIALOG_PROCESS_KEY, dialogProcessId);
    params.set(PSEUDO_ROUTE_WORKFLOW_ROOT_KEY, rootSessionId);
  } else if (params.get(PSEUDO_ROUTE_PANEL_KEY) === PSEUDO_ROUTE_WORKFLOW_PANEL) {
    params.delete(PSEUDO_ROUTE_PANEL_KEY);
    params.delete(PSEUDO_ROUTE_WORKFLOW_DIALOG_PROCESS_KEY);
    params.delete(PSEUDO_ROUTE_WORKFLOW_ROOT_KEY);
  }
  const query = params.toString();
  const nextUrl = `${window.location.pathname}${query ? `?${query}` : ""}${window.location.hash || ""}`;
  const nextState = {
    ...(history.state && typeof history.state === "object" ? history.state : {}),
    noobotWorkflowNodeSession:
      dialogProcessId && rootSessionId
        ? { dialogProcessId, rootSessionId }
        : null,
  };
  if (mode === "push") {
    history.pushState(nextState, "", nextUrl);
    return;
  }
  history.replaceState(nextState, "", nextUrl);
}

export function parseWorkflowDrawerRoute(eventState = null) {
  const routeFromState =
    eventState && typeof eventState === "object"
      ? eventState.noobotWorkflowNodeSession
      : null;
  if (routeFromState && typeof routeFromState === "object") {
    const dialogProcessId = String(routeFromState?.dialogProcessId || "").trim();
    const rootSessionId = String(routeFromState?.rootSessionId || "").trim();
    if (dialogProcessId && rootSessionId) return { dialogProcessId, rootSessionId };
  }
  const params = new URLSearchParams(window.location.search || "");
  if (params.get(PSEUDO_ROUTE_PANEL_KEY) !== PSEUDO_ROUTE_WORKFLOW_PANEL) {
    return { dialogProcessId: "", rootSessionId: "" };
  }
  const dialogProcessId = String(params.get(PSEUDO_ROUTE_WORKFLOW_DIALOG_PROCESS_KEY) || "").trim();
  return {
    dialogProcessId,
    rootSessionId: String(params.get(PSEUDO_ROUTE_WORKFLOW_ROOT_KEY) || "").trim(),
  };
}

export function useWorkflowDrawerHistory({
  workflowPayload,
  flowNodes,
  applyingWorkflowDrawerHistory,
}) {
  function pushWorkflowDrawerHistory(route = {}) {
    if (applyingWorkflowDrawerHistory.value) return;
    writeWorkflowDrawerHistory(route, { mode: "push" });
  }

  function replaceWorkflowDrawerHistory(route = {}) {
    if (applyingWorkflowDrawerHistory.value) return;
    writeWorkflowDrawerHistory(route, { mode: "replace" });
  }

  function buildDrawerRoute(nodeItem = {}, patch = {}) {
    return buildWorkflowDrawerRoute(nodeItem, workflowPayload.value, patch);
  }

  function collectWorkflowSessionTargets() {
    const targets = [];
    for (const nodeItem of Array.isArray(flowNodes.value) ? flowNodes.value : []) {
      if (resolveWorkflowDialogProcessId(nodeItem)) targets.push(nodeItem);
      for (const stateBox of Array.isArray(nodeItem?.actionNodeStates) ? nodeItem.actionNodeStates : []) {
        for (const stepItem of Array.isArray(stateBox?.steps) ? stateBox.steps : []) {
          if (resolveWorkflowDialogProcessId(stepItem)) targets.push(stepItem);
        }
      }
    }
    return targets;
  }

  function findWorkflowSessionTarget(route = {}) {
    const dialogProcessId = String(route?.dialogProcessId || "").trim();
    const rootSessionId = String(route?.rootSessionId || "").trim();
    if (!dialogProcessId || !rootSessionId) return null;
    return (
      collectWorkflowSessionTargets().find((target = {}) => {
        const targetDialogProcessId = resolveWorkflowDialogProcessId(target);
        const targetRootSessionId = String(
          target?.rootSessionId ||
            workflowPayload.value?.planningDialog?.sessionId ||
            workflowPayload.value?.runMeta?.sessionId ||
            "",
        ).trim();
        return targetDialogProcessId === dialogProcessId && targetRootSessionId === rootSessionId;
      }) || null
    );
  }

  return {
    buildWorkflowDrawerRoute: buildDrawerRoute,
    pushWorkflowDrawerHistory,
    replaceWorkflowDrawerHistory,
    parseWorkflowDrawerRoute,
    findWorkflowSessionTarget,
  };
}
