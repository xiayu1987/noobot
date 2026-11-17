/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

export const TASK_ORCHESTRATION_TOOL_SCHEMA = {
  task_check: {
    description: {
      key: "tools.task_check.description",
      text: "提交当前任务检查切片。收到周期任务检查提示后按需调用，不强制。checkContent 必须严格遵循 NOOBOT_TASK_CHECK/1 唯一文本协议，按顺序且仅包含 [STATE]、[ABSTRACT]、[DETAILS]、[NEXT_ACTION] 四段；STATE 只能为 CONTINUE、COMPLETE 或 BLOCKED。该工具不创建小结标记或附件，结果只返回派生回执。",
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
