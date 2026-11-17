/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

export const TASK_ORCHESTRATION_MANUAL = {
  task_check: {
    summary: "提交任务检查切片，记录当前进展与下一步。",
    usage: ["{{tool:task_check}}({ checkContent })"],
    params: {
      checkContent: "严格遵循 NOOBOT_TASK_CHECK/1 文本协议的检查正文。",
    },
    protocol: [
      "首行固定为 NOOBOT_TASK_CHECK/1。",
      "按顺序且仅包含四段：[STATE]、[ABSTRACT]、[DETAILS]、[NEXT_ACTION]。",
      "STATE 只能为 CONTINUE、COMPLETE 或 BLOCKED。",
      "ABSTRACT 写简短任务检查摘要，DETAILS 写当前目标、进展、偏移风险与遗漏，NEXT_ACTION 写明确的下一步动作。",
      "所有段落非空，不得增加、重复或调整段落。",
    ],
    notes: [
      "收到周期任务检查提示后按需调用，不强制。",
      "该工具不创建小结标记或附件，结果只返回派生回执。",
    ],
  },
};
