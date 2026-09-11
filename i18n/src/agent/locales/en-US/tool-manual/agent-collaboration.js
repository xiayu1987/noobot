/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

export const AGENT_COLLABORATION_MANUAL = {
  delegate_task_async: {
    summary:
      "Delegate a subtask to a sub agent for asynchronous execution, returning its task identity immediately.",
    usage: ["delegate_task_async({ taskContent, taskName })"],
    params: {
      taskContent:
        "Full subtask description. It must be self-contained, since the sub agent cannot see the current conversation.",
      taskName: "Task name, used for later identification and result collection.",
    },
    notes: [
      "Suited to parallel, mutually independent work, such as investigating several files or running separate verification sets at once.",
      "After the identity comes back, collect results with wait_async_task_result; delegating alone is not completion.",
      "Sub agents are structurally identical to the main session in lifecycle and persistence; only the entry point and execution policy differ.",
    ],
    pitfalls: [
      "Omitting premises from the description leaves the sub agent without context and it will head the wrong way.",
      "Delegating without collecting results loses the work; do not claim completion from delegation alone.",
    ],
  },
  wait_async_task_result: {
    summary: "Wait for and collect results of previously delegated asynchronous subtasks.",
    usage: ["wait_async_task_result({ taskIds, timeoutMs })"],
    params: {
      taskIds: "Task identities to wait for.",
      timeoutMs: "Wait limit; on timeout the unfinished state is returned as is.",
    },
    notes: [
      "Several tasks can be awaited in one call; check each returned status rather than assuming all succeeded.",
    ],
    pitfalls: [
      "A timeout is neither failure nor success. Report the actual returned status.",
    ],
  },
  plan_multi_task_collaboration: {
    summary: "Plan a multi-task collaboration structure, producing an executable breakdown.",
    usage: ["plan_multi_task_collaboration({ objective, taskList })"],
    params: {
      objective: "Description of the overall goal.",
      taskList: "Task breakdown with each task's responsibility and dependencies.",
    },
    notes: [
      "For complex goals that need orchestration. Simple single-step requests should just be done directly.",
    ],
    pitfalls: ["Planning is not execution; delegation and collection still have to happen."],
  },
};
