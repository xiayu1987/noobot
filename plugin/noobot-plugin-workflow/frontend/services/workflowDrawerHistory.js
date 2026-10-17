/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

import { resolveWorkflowDialogProcessId } from "../utils/workflowDialogProcessId.js";
import { text } from "@noobot/shared/value";

export const WORKFLOW_DIALOG_PROCESS_QUERY_KEY = "workflowDialogProcessId";
export const WORKFLOW_ROOT_SESSION_QUERY_KEY = "workflowRootSessionId";

export function buildWorkflowDrawerRoute(nodeItem = {}, workflowPayload = {}, patch = {}) {
  const dialogProcessId = String(
    Object.prototype.hasOwnProperty.call(patch, "dialogProcessId")
      ? patch.dialogProcessId
      : resolveWorkflowDialogProcessId(nodeItem),
  ).trim();
  const rootSessionId = String(
    Object.prototype.hasOwnProperty.call(patch, "rootSessionId")
      ? patch.rootSessionId
      : nodeItem?.rootSessionId || workflowPayload?.runMeta?.sessionId || "",
  ).trim();
  return { dialogProcessId, rootSessionId };
}

export function readWorkflowDrawerQuery() {
  const params = new URLSearchParams(window.location.search || "");
  return {
    dialogProcessId: text(params.get(WORKFLOW_DIALOG_PROCESS_QUERY_KEY)),
    rootSessionId: text(params.get(WORKFLOW_ROOT_SESSION_QUERY_KEY)),
  };
}

export function writeWorkflowDrawerQuery(route = {}) {
  const dialogProcessId = text(route?.dialogProcessId);
  const rootSessionId = text(route?.rootSessionId);
  const params = new URLSearchParams(window.location.search || "");
  if (dialogProcessId && rootSessionId) {
    params.set(WORKFLOW_DIALOG_PROCESS_QUERY_KEY, dialogProcessId);
    params.set(WORKFLOW_ROOT_SESSION_QUERY_KEY, rootSessionId);
  } else {
    params.delete(WORKFLOW_DIALOG_PROCESS_QUERY_KEY);
    params.delete(WORKFLOW_ROOT_SESSION_QUERY_KEY);
  }
  const query = params.toString();
  const nextUrl = `${window.location.pathname}${query ? `?${query}` : ""}${window.location.hash || ""}`;
  const currentUrl = `${window.location.pathname}${window.location.search || ""}${window.location.hash || ""}`;
  if (nextUrl === currentUrl) return;
  history.replaceState(history.state, "", nextUrl);
}

export function useWorkflowDrawerHistory({ workflowPayload, flowNodes }) {
  function buildDrawerRoute(nodeItem = {}, patch = {}) {
    return buildWorkflowDrawerRoute(nodeItem, workflowPayload.value, patch);
  }

  function collectWorkflowSessionTargets() {
    const targets = [];
    for (const nodeItem of Array.isArray(flowNodes.value) ? flowNodes.value : []) {
      if (resolveWorkflowDialogProcessId(nodeItem)) targets.push(nodeItem);
      for (const stateBox of Array.isArray(nodeItem?.actionNodeStates)
        ? nodeItem.actionNodeStates
        : []) {
        for (const stepItem of Array.isArray(stateBox?.steps) ? stateBox.steps : []) {
          if (resolveWorkflowDialogProcessId(stepItem)) targets.push(stepItem);
        }
      }
    }
    return targets;
  }

  function findWorkflowSessionTarget(route = {}) {
    const dialogProcessId = text(route?.dialogProcessId);
    const rootSessionId = text(route?.rootSessionId);
    if (!dialogProcessId || !rootSessionId) return null;
    return (
      collectWorkflowSessionTargets().find((target = {}) => {
        const targetDialogProcessId = resolveWorkflowDialogProcessId(target);
        const targetRootSessionId = text(
          target?.rootSessionId || workflowPayload.value?.runMeta?.sessionId,
        );
        return targetDialogProcessId === dialogProcessId && targetRootSessionId === rootSessionId;
      }) || null
    );
  }

  return {
    buildWorkflowDrawerRoute: buildDrawerRoute,
    findWorkflowSessionTarget,
  };
}
