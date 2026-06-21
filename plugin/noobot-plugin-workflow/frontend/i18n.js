/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

import { useLocale } from "../../../client/noobot-chat/src/shared/i18n/useLocale";

const FALLBACK_LOCALE = "zh-CN";

const WORKFLOW_FRONTEND_MESSAGES = Object.freeze({
  "zh-CN": Object.freeze({
    workflow: Object.freeze({
      statusSuccess: "成功",
      statusFailed: "失败",
      statusRunning: "执行中",
      statusPending: "待执行",
      stateStart: "开始",
      stateEnd: "结束",
      stateBranch: "分叉",
      stateMerge: "汇聚",
      stateNormal: "状态",
      nodeFallback: "节点{index}",
      parallelOrder: "并发#{wave} · 序{order}",
      expand: "展开",
      collapse: "收起",
      nodeBoxCount: "{count} 节点Box",
      canvasTitle: "Canvas流程图",
      reset: "重置",
      actionNode: "动作节点",
      runtimeState: "运行态",
      runtimeInspectorSubtitle: "节点Box / 步骤Box，点击步骤Box查看子 agent session",
      stepCount: "{count} 步",
      noStepBox: "暂无步骤Box",
      stepBoxLabel: "步骤Box #{order}",
      nodeBoxLabelFallback: "节点Box #{index}",
      nodeBoxLabel: "节点Box {id}",
      empty: "（空）",
      nodeSessionMissing: "工作流节点会话标识缺失",
      readNodeSessionFailed: "读取节点会话失败",
      planningOutputTitle: "工作流规划模型输出",
      lineCount: "{count} 行",
      componentizedNodes: "工作流节点（组件化流程）",
      noWorkflowNodes: "暂无工作流节点",
      nodeSessionTitle: "节点会话 {sessionId}",
      loadingNodeSession: "正在加载节点会话...",
      noNodeSessionContent: "暂无节点会话内容",
    }),
    modelExtension: Object.freeze({
      title: "Workflow 插件",
      description: "为工作流非主流程语义理解请求单独指定模型。",
      field: "非主流程语义模型",
      placeholder: "使用主流程/默认模型",
      empty: "暂无可用于对话的启用模型",
    }),
  }),
  "en-US": Object.freeze({
    workflow: Object.freeze({
      statusSuccess: "Success",
      statusFailed: "Failed",
      statusRunning: "Running",
      statusPending: "Pending",
      stateStart: "Start",
      stateEnd: "End",
      stateBranch: "Branch",
      stateMerge: "Merge",
      stateNormal: "State",
      nodeFallback: "Node {index}",
      parallelOrder: "Parallel #{wave} · Seq {order}",
      expand: "Expand",
      collapse: "Collapse",
      nodeBoxCount: "{count} Node Box(es)",
      canvasTitle: "Canvas Workflow Graph",
      reset: "Reset",
      actionNode: "Action Node",
      runtimeState: "Runtime",
      runtimeInspectorSubtitle: "Node Box / Step Box. Click a Step Box to view child agent session",
      stepCount: "{count} step(s)",
      noStepBox: "No Step Box yet",
      stepBoxLabel: "Step Box #{order}",
      nodeBoxLabelFallback: "Node Box #{index}",
      nodeBoxLabel: "Node Box {id}",
      empty: "(Empty)",
      nodeSessionMissing: "Workflow node session identifier is missing",
      readNodeSessionFailed: "Failed to read node session",
      planningOutputTitle: "Workflow Planning Model Output",
      lineCount: "{count} lines",
      componentizedNodes: "Workflow Nodes (Componentized)",
      noWorkflowNodes: "No workflow nodes",
      nodeSessionTitle: "Node Session {sessionId}",
      loadingNodeSession: "Loading node session...",
      noNodeSessionContent: "No node session content",
    }),
    modelExtension: Object.freeze({
      title: "Workflow Plugin",
      description: "Configure a separate model for non-main-flow workflow semantic requests.",
      field: "Non-main-flow semantic model",
      placeholder: "Use main/default model",
      empty: "No enabled chat models are available",
    }),
  }),
});

function resolvePath(source = {}, key = "") {
  return String(key || "")
    .split(".")
    .filter(Boolean)
    .reduce((acc, part) => (acc && typeof acc === "object" ? acc[part] : undefined), source);
}

function applyParams(text = "", params = {}) {
  let output = String(text || "");
  for (const [key, value] of Object.entries(params || {})) {
    output = output.replaceAll(`{${key}}`, String(value ?? ""));
  }
  return output;
}

export function useWorkflowLocale() {
  const { locale, translate: translateGlobal } = useLocale();

  function translate(key = "", params = {}) {
    const localTable = WORKFLOW_FRONTEND_MESSAGES[locale.value] || WORKFLOW_FRONTEND_MESSAGES[FALLBACK_LOCALE] || {};
    const fallbackTable = WORKFLOW_FRONTEND_MESSAGES[FALLBACK_LOCALE] || {};
    const localHit = resolvePath(localTable, key);
    const fallbackHit = resolvePath(fallbackTable, key);
    const raw = localHit ?? fallbackHit;
    if (raw === undefined || raw === null) return translateGlobal(key, params);
    return applyParams(raw, params);
  }

  return {
    locale,
    translate,
  };
}
