/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { replayEvidence } from "./replay-context.mjs";

export function semanticAcceptanceReply(messages) {
  const request = messages.find((message) => /"finalOutput"\s*:/.test(message.content));
  const field = request?.content.match(/"finalOutput"\s*:\s*("(?:[^"\\]|\\.)*")/);
  if (!field) throw new TypeError("Missing semantic acceptance final output");
  const output = JSON.parse(field[1]);
  if (
    !/^NOOBOT-PERF-DONE:runtime\/ops_workdir\/e2e-[A-Za-z0-9_-]+\/perf-[1-9]\d*\.txt$/.test(output)
  )
    throw new TypeError("Invalid semantic acceptance final output");
  return {
    content: `ADD A1 plan=1 status=pass risk=low evidence=${output} [Declared replay completed; verify tool signals and phase reports]`,
  };
}

export function harnessReply(purpose, context) {
  const evidence = replayEvidence(context);
  switch (purpose) {
    case "planning":
      return {
        content:
          "[CURRENT_TASK_GOAL]\nComplete the deterministic performance replay.\n[PLAN]\nADD [1] Execute the declared tool sequence and verify its results.",
      };
    case "planning_revision":
      return {
        content: `UPDATE [1] Verify replay results through observed step ${context.completed}, then complete the remaining declared sequence.`,
      };
    case "planning_refinement":
      return { content: "ADD [1.1] Verify ordered tool results." };
    case "summary":
      return {
        content: `[SUMMARY_OVERVIEW]\n1. [plan=1][status=in_progress][evidence=tool call identities][file=-][method=-][line=-] ${evidence}\n[SUMMARY_DETAIL]\n${evidence}\nContinue from the observed tool call identity; earlier progress is superseded.\n[NEXT_EXECUTION_SUGGESTION]\n[NEXT_ACTION]\naction = inspect\ntarget = ${context.filePath}\nreason = Continue the declared replay from observed progress\nblocking = false\n[SUMMARY_END]`,
      };
    case "guidance":
      return { content: "Continue the declared tool sequence using the observed replay progress." };
    case "phase_acceptance":
      return {
        content: `ADD A1 plan=1 status=warn risk=low evidence=observed_step_${context.completed} [Verify completion against the declared replay before claiming success]`,
      };
    default:
      throw new TypeError(`Unsupported Harness capability: ${purpose}`);
  }
}
