/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

export const TASK_ORCHESTRATION_TOOL_SCHEMA = {
  "delegate_task_async": {
    "description": {
      "key": "tools.agent_collab.delegateDescription",
      "text": "并发委派多个子任务。输入 tasks 列表（每项含 taskName、taskContent）。返回异步任务容器结果。"
    },
    "params": {
      "tasks": {
        "key": "tools.agent_collab.fieldTasks",
        "text": "子任务列表。"
      },
      "tasks[].taskContent": {
        "key": "tools.agent_collab.fieldTaskContent",
        "text": "子任务内容。"
      },
      "tasks[].taskName": {
        "key": "tools.agent_collab.fieldTaskName",
        "text": "子任务名称。"
      }
    },
    "texts": {
      "tools.agent_collab.childAsyncResultContainersRequired": "childAsyncResultContainers 必填",
      "tools.agent_collab.dialogContextHint": "delegate_task_async 需要当前对话流程上下文",
      "tools.agent_collab.humanTaskPrefix": "任务文本：",
      "tools.agent_collab.noResult": "(无结果)",
      "tools.agent_collab.parentSessionIdRequired": "parentSessionId 必填",
      "tools.agent_collab.planPrompt1": "多任务协作规划。",
      "tools.agent_collab.planPrompt2": "请输出规划内容与任务调用链。",
      "tools.agent_collab.planPrompt3": "输出必须是 JSON，不要使用 markdown 代码块。",
      "tools.agent_collab.planPrompt4": "JSON 格式：",
      "tools.agent_collab.planPrompt5": "{ \"tasks\":[{ \"taskName\":\"任务a\", \"taskContent\":\"任务目标、内容\",\"subTasks\":[] }] }",
      "tools.agent_collab.runtimeDialogProcessIdMissing": "运行时缺少 dialogProcessId",
      "tools.agent_collab.runtimeMissingBotManagerUserId": "运行时缺少 bot manager/user id",
      "tools.agent_collab.runtimeSessionIdMissing": "运行时缺少 sessionId",
      "tools.agent_collab.sessionContextHint": "delegate_task_async 需要当前会话上下文",
      "tools.agent_collab.taskNameTaskContentRequired": "taskName 与 taskContent 必填",
      "tools.agent_collab.tasksRequired": "tasks 必填"
    }
  },
  "plan_multi_task_collaboration": {
    "description": {
      "key": "tools.agent_collab.planDescription",
      "text": "规划多任务协作方案。输入 task。返回拆解后的协作计划结果。"
    },
    "params": {
      "task": {
        "key": "tools.agent_collab.fieldPlanTask",
        "text": "任务描述。"
      }
    },
    "texts": {}
  },
  "task_summary": {
    "description": {
      "key": "tools.task_summary.description",
      "text": "提交当前任务阶段小结。仅在系统要求阶段小结时调用；summaryContent 需详细说明当前目标、已完成事项、关键结果/文件/状态、未完成事项和下一步；编程模式下必须包含文件路径、方法/函数名与行号（支持多段行号/范围，如 10-20,35,48-52）。"
    },
    "params": {
      "summaryContent": {
        "key": "tools.task_summary.fieldSummaryContent",
        "text": "阶段小结内容。请详细覆盖当前任务状态、关键结果、遗留问题和下一步；编程模式下写明文件路径、方法/函数名与行号（支持多段行号/范围，如 10-20,35,48-52）。"
      }
    },
    "texts": {
      "tools.task_summary.summaryContentRequired": "summaryContent 必填",
      "tools.task_summary.summaryCompletedContinue": "小结完毕，请继续当前任务"
    }
  },
  "wait": {
    "description": {
      "key": "tools.wait.description",
      "text": "同步等待一段时间。输入 waitMs。返回等待完成结果。"
    },
    "params": {
      "waitMs": {
        "key": "tools.wait.fieldWaitMs",
        "text": "等待时长（毫秒）。"
      }
    },
    "texts": {}
  },
  "wait_async_task_result": {
    "description": {
      "key": "tools.agent_collab.waitDescription",
      "text": "等待异步子任务结果汇总。输入 timeoutMs、pollIntervalMs（可选）。返回子任务执行结果。"
    },
    "params": {
      "pollIntervalMs": {
        "key": "tools.agent_collab.fieldPollIntervalMs",
        "text": "轮询间隔毫秒（可选）。"
      },
      "timeoutMs": {
        "key": "tools.agent_collab.fieldTimeoutMs",
        "text": "超时时间毫秒（可选）。"
      }
    },
    "texts": {}
  },
  "set_skill_task": {
    "description": {
      "key": "tools.skill.setDescription",
      "text": "设置技能任务状态。输入 action、taskId、taskName、skillName（可选 result）。返回状态更新结果。"
    },
    "params": {
      "action": {
        "key": "tools.skill.fieldAction",
        "text": "可选项：start|completed。任务动作。"
      },
      "result": {
        "key": "tools.skill.fieldResult",
        "text": "任务结果（可选）。"
      },
      "skillName": {
        "key": "tools.skill.fieldSkillName",
        "text": "技能名称。"
      },
      "taskId": {
        "key": "tools.skill.fieldTaskId",
        "text": "任务 ID。"
      },
      "taskName": {
        "key": "tools.skill.fieldTaskName",
        "text": "任务名称。"
      }
    },
    "texts": {
      "tools.skill.invalidAction": (params = {}) => `无效的操作类型: ${String(params.action || "").trim()}`,
      "tools.skill.skillNameRequiredOnStart": "action=start 时必须提供 skillName"
    }
  },
  "list_skills": {
    "description": {
      "key": "tools.skill.listDescription",
      "text": "查看技能目录结构。输入 parentSkill（可选）。返回对应目录层级内容。"
    },
    "params": {
      "parentSkill": {
        "key": "tools.skill.fieldParentSkill",
        "text": "技能子路径（可选）。"
      }
    },
    "texts": {}
  },
};
