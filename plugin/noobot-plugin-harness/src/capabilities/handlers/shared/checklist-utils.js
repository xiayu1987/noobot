/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { LOCALE } from "./constants.js";
import { getDefaultTaskOwner, getTaskTemplate } from "./i18n.js";
import { text } from "@noobot/shared/value";

export function createChecklistItem({ mainId = 0, subIndex = null, task = "" } = {}) {
  const isMainStep = subIndex === null;
  return {
    index: isMainStep ? String(mainId) : `${mainId}.${subIndex}`,
    mainStepIndex: mainId,
    isMainStep,
    task,
  };
}

export function buildPlanSnapshot(bucket = {}, locale = LOCALE.ZH_CN) {
  const source = bucket && typeof bucket === "object" ? bucket : {};
  return {
    totalGoal: text(source.totalGoal),
    taskOwner: text(source.taskOwner) || getDefaultTaskOwner(locale),
    nextPhase: source.nextPhase && typeof source.nextPhase === "object" ? source.nextPhase : null,
    revisionCount: Array.isArray(source.planRevisions) ? source.planRevisions.length : 0,
    operationDirectory:
      source.operationDirectory && typeof source.operationDirectory === "object"
        ? source.operationDirectory
        : null,
  };
}

export function defaultTaskChecklist(locale = LOCALE.ZH_CN) {
  const template = getTaskTemplate(locale);
  return [
    template.PARSE_ATTACHMENT,
    template.EXECUTE_CORE,
    template.START_SUBTASK,
    template.WAIT_SUBTASK_RESULT,
  ].map((task, position) => createChecklistItem({ mainId: position + 1, task }));
}
