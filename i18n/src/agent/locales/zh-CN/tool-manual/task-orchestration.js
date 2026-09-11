/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

export const TASK_ORCHESTRATION_MANUAL = {
  task_summary: {
    summary: "提交当前任务阶段小结，作为后续流程的权威阶段状态。",
    usage: ["task_summary({ summaryContent })"],
    params: {
      summaryContent: "严格遵循 NOOBOT_TASK_SUMMARY/1 文本协议的小结正文。",
    },
    protocol: [
      "首行固定为 NOOBOT_TASK_SUMMARY/1。",
      "按顺序且仅包含四段：[STATE]、[ABSTRACT]、[DETAILS]、[NEXT_ACTION]。",
      "STATE 只能为 CONTINUE、COMPLETE 或 BLOCKED。",
      "ABSTRACT 写已完成阶段的简短事实摘要。",
      "DETAILS 写整合此前小结后的权威阶段状态，区分已完成、关键结果、剩余与阻塞；编程模式须含文件路径、函数名与行号。",
      "NEXT_ACTION 写尚未完成且紧接着要执行的唯一明确动作。",
      "所有段落非空，不得增加、重复或调整段落。",
    ],
    notes: [
      "仅在系统要求阶段小结时调用，不要自行发起。",
      "小结回执是权威阶段状态：已完成事项不得重新执行，CONTINUE 后只从 NEXT_ACTION 继续。",
      "完整内容只通过 summaryContent 提交，工具结果只返回派生回执与附件引用。",
    ],
    pitfalls: [
      "COMPLETE 表示任务完成并进入无工具最终回复，BLOCKED 表示无法继续并进入无工具阻塞说明，不要与 CONTINUE 混用。",
      "段落缺失、顺序错乱或额外加段都会导致协议校验失败。",
    ],
  },
  task_check: {
    summary: "提交任务检查切片，记录当前进展与下一步。",
    usage: ["task_check({ checkContent })"],
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
      "仅在系统发出周期任务检查提示时按需调用，不强制调用。",
      "该工具不创建小结标记或附件，结果只返回派生回执。",
    ],
    pitfalls: ["与 task_summary 的协议头不同，两者不可互换套用。"],
  },
};
