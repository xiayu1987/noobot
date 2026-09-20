/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { LOCALE } from "./constants.js";
import {
  HARNESS_I18N_KEYSET,
  getDefaultSubtaskOwners,
  getDefaultTaskOwner,
  getTaskTemplate,
  translateI18nText,
} from "./i18n.js";

function normalizeFilePlan(files = null) {
  const source = files && typeof files === "object" && !Array.isArray(files) ? files : {};
  const readArray = (...keys) => {
    for (const key of keys) {
      if (Array.isArray(source[key]))
        return source[key].map((item) => String(item || "").trim()).filter(Boolean);
    }
    return [];
  };
  return {
    create: readArray("create", "created", "add", "\u65b0\u589e", "new"),
    modify: readArray("modify", "modified", "change", "update", "\u4fee\u6539"),
    delete: readArray("delete", "deleted", "remove", "\u5220\u9664"),
  };
}

export function normalizeChecklistItem(item = {}, index = 0, locale = LOCALE.ZH_CN) {
  const source = item && typeof item === "object" ? item : {};
  const normalizedIndex = Number(source.index ?? source.seq ?? source.id ?? index + 1);
  const mainStepCandidate = Number(
    source.mainStepIndex ?? source.parentIndex ?? source.refineFrom ?? source.refinementOf,
  );
  const hasMainStepCandidate = Number.isFinite(mainStepCandidate);
  const resolvedMainStepIndex = hasMainStepCandidate ? mainStepCandidate : normalizedIndex;
  const isMainStep =
    source.isMainStep === true ||
    !hasMainStepCandidate ||
    resolvedMainStepIndex === normalizedIndex;
  const fallbackTaskName = translateI18nText(
    locale,
    HARNESS_I18N_KEYSET.CHECKLIST.TASK_DEFAULT_NAME_TEMPLATE,
    {
      index: index + 1,
    },
  );
  return {
    index: normalizedIndex,
    mainStepIndex: Number(resolvedMainStepIndex),
    isMainStep,
    task: String(source.task ?? source.name ?? source.todo ?? "").trim() || fallbackTaskName,
    owner:
      String(source.owner ?? source.assignee ?? getDefaultTaskOwner(locale)).trim() ||
      getDefaultTaskOwner(locale),
    subOwners: Array.isArray(source.subOwners ?? source.subTaskOwners)
      ? (source.subOwners ?? source.subTaskOwners)
          .map((name) => String(name || "").trim())
          .filter(Boolean)
      : [],
    input: String(source.input ?? source.inputs ?? source.requiredInput ?? "").trim(),
    output: String(source.output ?? source.outputs ?? source.expectedOutput ?? "").trim(),
    files: normalizeFilePlan(source.files ?? source.fileChanges ?? source.filePlan),
  };
}

export function buildPlanSnapshot(bucket = {}, locale = LOCALE.ZH_CN) {
  const source = bucket && typeof bucket === "object" ? bucket : {};
  return {
    totalGoal: String(source.totalGoal || "").trim(),
    planText: String(source.planText || "").trim(),
    taskOwner:
      String(source.taskOwner || getDefaultTaskOwner(locale)).trim() || getDefaultTaskOwner(locale),
    nextPhase: source.nextPhase && typeof source.nextPhase === "object" ? source.nextPhase : null,
    checklistSource: String(source.taskChecklistSource || "").trim(),
    revisionCount: Array.isArray(source.planRevisions) ? source.planRevisions.length : 0,
    operationDirectory:
      source.operationDirectory && typeof source.operationDirectory === "object"
        ? source.operationDirectory
        : null,
  };
}

export function defaultTaskChecklist(locale = LOCALE.ZH_CN) {
  const owner = getDefaultTaskOwner(locale);
  const template = getTaskTemplate(locale);
  const emptyFiles = () => ({ create: [], modify: [], delete: [] });
  return [
    {
      index: 1,
      task: template.PARSE_ATTACHMENT,
      owner,
      subOwners: [],
      input: "user attachments/context",
      output: "parsed attachment/context data",
      files: emptyFiles(),
    },
    {
      index: 2,
      task: template.EXECUTE_CORE,
      owner,
      subOwners: [],
      input: "task requirements and parsed data",
      output: "core task result",
      files: emptyFiles(),
    },
    {
      index: 3,
      task: template.START_SUBTASK,
      owner,
      subOwners: getDefaultSubtaskOwners(locale),
      input: "delegable subtasks",
      output: "started subtask records",
      files: emptyFiles(),
    },
    {
      index: 4,
      task: template.WAIT_SUBTASK_RESULT,
      owner,
      subOwners: [],
      input: "started subtask records",
      output: "merged subtask results",
      files: emptyFiles(),
    },
  ];
}
