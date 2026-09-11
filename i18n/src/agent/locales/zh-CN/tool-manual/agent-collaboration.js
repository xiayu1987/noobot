/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

export const AGENT_COLLABORATION_MANUAL = {
  delegate_task_async: {
    summary: "把子任务派发给子 Agent 异步执行，立即返回任务身份。",
    usage: ["delegate_task_async({ taskContent, taskName })"],
    params: {
      taskContent: "子任务的完整描述，必须自包含，子 Agent 看不到当前对话上下文。",
      taskName: "任务名，用于后续识别与结果归集。",
    },
    notes: [
      "适用于可并行且相互独立的工作，例如同时排查多个文件或分别跑多组验证。",
      "返回任务身份后需用 wait_async_task_result 收集结果，派发本身不代表已完成。",
      "子 Agent 与主会话在生命周期与持久化上同构，只是入口与执行策略不同。",
    ],
    pitfalls: [
      "任务描述里省略前提会导致子 Agent 缺少上下文而做错方向。",
      "派发后不收集结果等于任务丢失，不要只派发就宣称完成。",
    ],
  },
  wait_async_task_result: {
    summary: "等待并收集此前派发的异步子任务结果。",
    usage: ["wait_async_task_result({ taskIds, timeoutMs })"],
    params: {
      taskIds: "待等待的任务身份列表。",
      timeoutMs: "等待上限，超时按未完成如实返回。",
    },
    notes: ["多个任务可一次性等待，返回后需逐项核对实际状态而不是假定全部成功。"],
    pitfalls: ["超时未完成不等于失败，也不等于成功，必须按真实返回状态报告。"],
  },
  plan_multi_task_collaboration: {
    summary: "规划多任务协作结构，产出可执行的任务分解。",
    usage: ["plan_multi_task_collaboration({ objective, taskList })"],
    params: {
      objective: "总体目标描述。",
      taskList: "任务分解列表，含各任务职责与依赖关系。",
    },
    notes: ["用于需要编排的复杂目标；简单且单步的请求应直接执行，不必编排。"],
    pitfalls: ["规划不等于执行，规划完成后仍需真实派发与收集。"],
  },
};
