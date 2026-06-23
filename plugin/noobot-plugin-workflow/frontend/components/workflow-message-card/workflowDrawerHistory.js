/*
  Copyright (c) 2026 xiayu
  Contact: 126240622+xiayu1987@users.noreply.github.com
  SPDX-License-Identifier: MIT
*/

const PSEUDO_ROUTE_PANEL_KEY = "panel";
const PSEUDO_ROUTE_WORKFLOW_PANEL = "workflow-node-session";
const PSEUDO_ROUTE_WORKFLOW_DIALOG_KEY = "workflowDialogId";
const PSEUDO_ROUTE_WORKFLOW_ROOT_KEY = "workflowRootSessionId";

export function buildWorkflowDrawerRoute(nodeItem = {}, workflowPayload = {}, patch = {}) {
  const dialogId = String(
    Object.prototype.hasOwnProperty.call(patch, "dialogId")
      ? patch.dialogId
      : nodeItem?.dialogId || "",
  ).trim();
  const rootSessionId = String(
    Object.prototype.hasOwnProperty.call(patch, "rootSessionId")
      ? patch.rootSessionId
      : nodeItem?.rootSessionId ||
          workflowPayload?.planningDialog?.sessionId ||
          workflowPayload?.runMeta?.sessionId ||
          "",
  ).trim();
  return { dialogId, rootSessionId };
}

export function writeWorkflowDrawerHistory(route = {}, { mode = "replace" } = {}) {
  const dialogId = String(route?.dialogId || "").trim();
  const rootSessionId = String(route?.rootSessionId || "").trim();
  const params = new URLSearchParams(window.location.search || "");
  if (dialogId && rootSessionId) {
    params.set(PSEUDO_ROUTE_PANEL_KEY, PSEUDO_ROUTE_WORKFLOW_PANEL);
    params.set(PSEUDO_ROUTE_WORKFLOW_DIALOG_KEY, dialogId);
    params.set(PSEUDO_ROUTE_WORKFLOW_ROOT_KEY, rootSessionId);
  } else if (params.get(PSEUDO_ROUTE_PANEL_KEY) === PSEUDO_ROUTE_WORKFLOW_PANEL) {
    params.delete(PSEUDO_ROUTE_PANEL_KEY);
    params.delete(PSEUDO_ROUTE_WORKFLOW_DIALOG_KEY);
    params.delete(PSEUDO_ROUTE_WORKFLOW_ROOT_KEY);
  }
  const query = params.toString();
  const nextUrl = `${window.location.pathname}${query ? `?${query}` : ""}${window.location.hash || ""}`;
  const nextState = {
    ...(history.state && typeof history.state === "object" ? history.state : {}),
    noobotWorkflowNodeSession:
      dialogId && rootSessionId ? { dialogId, rootSessionId } : null,
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
    const dialogId = String(routeFromState?.dialogId || "").trim();
    const rootSessionId = String(routeFromState?.rootSessionId || "").trim();
    if (dialogId && rootSessionId) return { dialogId, rootSessionId };
  }
  const params = new URLSearchParams(window.location.search || "");
  if (params.get(PSEUDO_ROUTE_PANEL_KEY) !== PSEUDO_ROUTE_WORKFLOW_PANEL) {
    return { dialogId: "", rootSessionId: "" };
  }
  return {
    dialogId: String(params.get(PSEUDO_ROUTE_WORKFLOW_DIALOG_KEY) || "").trim(),
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
      if (nodeItem?.dialogId) targets.push(nodeItem);
      for (const stateBox of Array.isArray(nodeItem?.actionNodeStates) ? nodeItem.actionNodeStates : []) {
        for (const stepItem of Array.isArray(stateBox?.steps) ? stateBox.steps : []) {
          if (stepItem?.dialogId) targets.push(stepItem);
        }
      }
    }
    return targets;
  }

  function findWorkflowSessionTarget(route = {}) {
    const dialogId = String(route?.dialogId || "").trim();
    const rootSessionId = String(route?.rootSessionId || "").trim();
    if (!dialogId || !rootSessionId) return null;
    return (
      collectWorkflowSessionTargets().find((target = {}) => {
        const targetDialogId = String(target?.dialogId || "").trim();
        const targetRootSessionId = String(
          target?.rootSessionId ||
            workflowPayload.value?.planningDialog?.sessionId ||
            workflowPayload.value?.runMeta?.sessionId ||
            "",
        ).trim();
        return targetDialogId === dialogId && targetRootSessionId === rootSessionId;
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
