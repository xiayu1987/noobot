/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

export const TASK_ORCHESTRATION_TOOL_SCHEMA = {
  "delegate_task_async": {
    "description": {
      "key": "tools.agent_collab.delegateDescription",
      "text": "Delegate multiple subtasks concurrently. Input a tasks list (each includes taskName and taskContent). Returns async task container results."
    },
    "params": {
      "tasks": {
        "key": "tools.agent_collab.fieldTasks",
        "text": "Subtask list."
      },
      "tasks[].taskContent": {
        "key": "tools.agent_collab.fieldTaskContent",
        "text": "Subtask content."
      },
      "tasks[].taskName": {
        "key": "tools.agent_collab.fieldTaskName",
        "text": "Subtask name."
      }
    },
    "texts": {
      "tools.agent_collab.childAsyncResultContainersRequired": "childAsyncResultContainers required",
      "tools.agent_collab.dialogContextHint": "delegate_task_async requires current dialog process context",
      "tools.agent_collab.humanTaskPrefix": "Task text:",
      "tools.agent_collab.noResult": "(no result)",
      "tools.agent_collab.parentSessionIdRequired": "parentSessionId required",
      "tools.agent_collab.planPrompt1": "Multi-task collaboration planning.",
      "tools.agent_collab.planPrompt2": "Please output planning content and task call chain.",
      "tools.agent_collab.planPrompt3": "Output must be JSON. Do not use markdown code blocks.",
      "tools.agent_collab.planPrompt4": "JSON format:",
      "tools.agent_collab.planPrompt5": "{ \"tasks\":[{ \"taskName\":\"task_a\", \"taskContent\":\"task goal/content\",\"subTasks\":[] }] }",
      "tools.agent_collab.runtimeDialogProcessIdMissing": "runtime dialogProcessId missing",
      "tools.agent_collab.runtimeMissingBotManagerUserId": "runtime missing bot manager/user id",
      "tools.agent_collab.runtimeSessionIdMissing": "runtime sessionId missing",
      "tools.agent_collab.sessionContextHint": "delegate_task_async requires current session context",
      "tools.agent_collab.taskNameTaskContentRequired": "taskName/taskContent required",
      "tools.agent_collab.tasksRequired": "tasks required"
    }
  },
  "plan_multi_task_collaboration": {
    "description": {
      "key": "tools.agent_collab.planDescription",
      "text": "Plan multi-task collaboration. Input task. Returns decomposed collaboration plan result."
    },
    "params": {
      "task": {
        "key": "tools.agent_collab.fieldPlanTask",
        "text": "Task description."
      }
    },
    "texts": {}
  },
  "task_summary": {
    "description": {
      "key": "tools.task_summary.description",
      "text": "Submit the current task phase summary only when requested by the system. summaryContent must strictly follow the single NOOBOT_TASK_SUMMARY/1 text protocol, with exactly [STATE], [ABSTRACT], [DETAILS], and [NEXT_ACTION] in that order. STATE must be CONTINUE, COMPLETE, or BLOCKED. The complete content exists only in this input; the tool result returns only a derived receipt and attachment reference."
    },
    "params": {
      "summaryContent": {
        "key": "tools.task_summary.fieldSummaryContent",
        "text": "Exact format: NOOBOT_TASK_SUMMARY/1\n[STATE]\nCONTINUE|COMPLETE|BLOCKED\n[ABSTRACT]\nShort abstract\n[DETAILS]\nComplete detailed content integrated with prior summaries, covering goals, completed work, key results, and remaining issues; in programming mode include file paths, function names, and line numbers\n[NEXT_ACTION]\nSpecific next action. CONTINUE resumes the normal tool loop; COMPLETE enters a no-tools final response; BLOCKED enters a no-tools blocker explanation. Every section must be non-empty; do not add, repeat, or reorder sections."
      }
    },
    "texts": {
      "tools.task_summary.summaryContentRequired": "summaryContent is required",
      "tools.task_summary.summaryProtocolInvalid": "summaryContent does not conform to NOOBOT_TASK_SUMMARY/1",
      "tools.task_summary.summaryCompletedFollowState": "Process the next flow according to the summary state, abstract, and next action."
    }
  },
  "task_check": {
    "description": {
      "key": "tools.task_check.description",
      "text": "Submit a task-check slice when the system emits a periodic task-check prompt. Calling it is optional. checkContent must strictly follow the single NOOBOT_TASK_CHECK/1 text protocol with exactly [STATE], [ABSTRACT], [DETAILS], and [NEXT_ACTION] in that order. STATE must be CONTINUE, COMPLETE, or BLOCKED. This tool creates neither a summary marker nor an attachment; its result contains only a derived receipt."
    },
    "params": {
      "checkContent": {
        "key": "tools.task_check.fieldCheckContent",
        "text": "Exact format: NOOBOT_TASK_CHECK/1\n[STATE]\nCONTINUE|COMPLETE|BLOCKED\n[ABSTRACT]\nShort task-check abstract\n[DETAILS]\nCurrent goal, progress, drift risks, and omissions\n[NEXT_ACTION]\nSpecific next action. Every section must be non-empty; do not add, repeat, or reorder sections."
      }
    },
    "texts": {
      "tools.task_check.checkContentRequired": "checkContent is required",
      "tools.task_check.checkProtocolInvalid": "checkContent does not conform to NOOBOT_TASK_CHECK/1",
      "tools.task_check.completed": "Task check recorded. Continue according to its state, abstract, and next action."
    }
  },
  "wait": {
    "description": {
      "key": "tools.wait.description",
      "text": "Wait synchronously for a duration. Input waitMs. Returns wait completion result."
    },
    "params": {
      "waitMs": {
        "key": "tools.wait.fieldWaitMs",
        "text": "Wait duration in milliseconds."
      }
    },
    "texts": {}
  },
  "wait_async_task_result": {
    "description": {
      "key": "tools.agent_collab.waitDescription",
      "text": "Wait for async subtask result aggregation. Input timeoutMs and pollIntervalMs (optional). Returns subtask execution results."
    },
    "params": {
      "pollIntervalMs": {
        "key": "tools.agent_collab.fieldPollIntervalMs",
        "text": "Polling interval in milliseconds (optional)."
      },
      "timeoutMs": {
        "key": "tools.agent_collab.fieldTimeoutMs",
        "text": "Timeout in milliseconds (optional)."
      }
    },
    "texts": {}
  },
  "set_skill_task": {
    "description": {
      "key": "tools.skill.setDescription",
      "text": "Set skill task status. Input action, taskId, taskName, and skillName (optional result). Returns status update result."
    },
    "params": {
      "action": {
        "key": "tools.skill.fieldAction",
        "text": "Options: start|completed. Task action."
      },
      "result": {
        "key": "tools.skill.fieldResult",
        "text": "Task result (optional)."
      },
      "skillName": {
        "key": "tools.skill.fieldSkillName",
        "text": "Skill name."
      },
      "taskId": {
        "key": "tools.skill.fieldTaskId",
        "text": "Task ID."
      },
      "taskName": {
        "key": "tools.skill.fieldTaskName",
        "text": "Task name."
      }
    },
    "texts": {
      "tools.skill.invalidAction": (params = {}) => `Invalid action type: ${String(params.action || "").trim()}`,
      "tools.skill.skillNameRequiredOnStart": "skillName is required when action=start"
    }
  },
  "list_skills": {
    "description": {
      "key": "tools.skill.listDescription",
      "text": "List skill directory structure. Input parentSkill (optional). Returns directory hierarchy items."
    },
    "params": {
      "parentSkill": {
        "key": "tools.skill.fieldParentSkill",
        "text": "Skill subpath (optional)."
      }
    },
    "texts": {}
  },
};
