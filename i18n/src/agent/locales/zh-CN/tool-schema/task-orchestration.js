/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

export const TASK_ORCHESTRATION_TOOL_SCHEMA = {
  task_summary: {
    description: {
      key: "tools.task_summary.description",
      text: "提交当前任务阶段小结。仅在系统要求阶段小结时调用。summaryContent 必须严格遵循 NOOBOT_TASK_SUMMARY/1 唯一文本协议，按顺序且仅包含 [STATE]、[ABSTRACT]、[DETAILS]、[NEXT_ACTION] 四段；STATE 只能为 CONTINUE、COMPLETE 或 BLOCKED。小结是后续流程的权威阶段状态：已完成事项不得重新执行，CONTINUE 后只从 NEXT_ACTION 继续。完整内容仅通过该输入提交，工具结果只返回派生回执和附件引用。",
    },
    params: {
      summaryContent: {
        key: "tools.task_summary.fieldSummaryContent",
        text: "严格格式：NOOBOT_TASK_SUMMARY/1\n[STATE]\nCONTINUE|COMPLETE|BLOCKED\n[ABSTRACT]\n已完成阶段的简短事实摘要\n[DETAILS]\n整合之前小结后的权威阶段状态；明确区分已完成事项、关键结果、剩余事项和阻塞，编程模式须含文件路径、函数名和行号\n[NEXT_ACTION]\n尚未完成且紧接着要执行的唯一明确动作。CONTINUE 表示只从 NEXT_ACTION 继续，不得重新执行 ABSTRACT 或 DETAILS 中已完成的事项；COMPLETE 表示任务完成并进入无工具最终回复；BLOCKED 表示无法继续并进入无工具阻塞说明。所有段落非空，不得增加、重复或调整段落。",
      },
    },
    texts: {
      "tools.task_summary.summaryContentRequired": "summaryContent 必填",
      "tools.task_summary.summaryProtocolInvalid":
        "summaryContent 不符合 NOOBOT_TASK_SUMMARY/1 协议",
      "tools.task_summary.summaryCompletedFollowState":
        "小结回执是后续流程的权威阶段状态。已完成事项不得重新执行；CONTINUE 时仅从 summary.nextAction 继续，COMPLETE 或 BLOCKED 时按对应状态结束。",
    },
  },
  task_check: {
    description: {
      key: "tools.task_check.description",
      text: "提交当前任务检查切片。仅在系统发出周期任务检查提示时按需调用，不强制调用。checkContent 必须严格遵循 NOOBOT_TASK_CHECK/1 唯一文本协议，按顺序且仅包含 [STATE]、[ABSTRACT]、[DETAILS]、[NEXT_ACTION] 四段；STATE 只能为 CONTINUE、COMPLETE 或 BLOCKED。该工具不创建小结标记或附件，结果只返回派生回执。",
    },
    params: {
      checkContent: {
        key: "tools.task_check.fieldCheckContent",
        text: "严格格式：NOOBOT_TASK_CHECK/1\n[STATE]\nCONTINUE|COMPLETE|BLOCKED\n[ABSTRACT]\n简短任务检查摘要\n[DETAILS]\n当前目标、进展、偏移风险和遗漏\n[NEXT_ACTION]\n明确的下一步动作。所有段落非空，不得增加、重复或调整段落。",
      },
    },
    texts: {
      "tools.task_check.checkContentRequired": "checkContent 必填",
      "tools.task_check.checkProtocolInvalid": "checkContent 不符合 NOOBOT_TASK_CHECK/1 协议",
      "tools.task_check.completed": "任务检查已记录，请根据检查状态、摘要和下一步继续处理。",
    },
  },
  list_skills: {
    description: {
      key: "tools.skill.listDescription",
      text: "查看技能目录结构。输入 parentSkill（可选）。返回对应目录层级内容。",
    },
    params: {
      parentSkill: {
        key: "tools.skill.fieldParentSkill",
        text: "技能子路径（可选）。",
      },
    },
    texts: {},
  },
};
