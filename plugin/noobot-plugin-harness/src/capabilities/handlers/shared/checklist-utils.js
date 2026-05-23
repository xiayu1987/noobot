/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { LOCALE } from "./constants.js";
import { getDefaultSubtaskOwners, getDefaultTaskOwner, getTaskTemplate } from "./i18n.js";
import { extractJsonObjectFromText, sanitizeJsonCandidate } from "./json-repair-utils.js";
export { extractJsonObjectFromText, sanitizeJsonCandidate } from "./json-repair-utils.js";

const WRAPPED_PAYLOAD_MAX_DEPTH = 3;
const WRAPPED_PAYLOAD_MAX_NODES = 100;
const WRAPPED_PAYLOAD_MAX_STRING_LENGTH = 200_000;
const CHECKLIST_HINT_RE = /taskchecklist|refinementchecklist|checklist|\"task\"|\"index\"|步骤|任务/i;
const STRIP_FENCED_BLOCK_RE = /```[\s\S]*?```/g;

function normalizeFilePlan(files = null) {
  const source = files && typeof files === "object" && !Array.isArray(files) ? files : {};
  const readArray = (...keys) => {
    for (const key of keys) {
      if (Array.isArray(source[key])) return source[key].map((item) => String(item || "").trim()).filter(Boolean);
    }
    return [];
  };
  return {
    create: readArray("create", "created", "add", "新增", "new"),
    modify: readArray("modify", "modified", "change", "update", "修改"),
    delete: readArray("delete", "deleted", "remove", "删除"),
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
    source.isMainStep === true || !hasMainStepCandidate || resolvedMainStepIndex === normalizedIndex;
  const fallbackTaskName =
    locale === LOCALE.EN_US ? `Task ${index + 1}` : `任务${index + 1}`;
  return {
    index: normalizedIndex,
    mainStepIndex: Number(resolvedMainStepIndex),
    isMainStep,
    task: String(source.task ?? source.name ?? source.todo ?? "").trim() || fallbackTaskName,
    owner:
      String(source.owner ?? source.assignee ?? getDefaultTaskOwner(locale)).trim() ||
      getDefaultTaskOwner(locale),
    subOwners: Array.isArray(source.subOwners ?? source.subTaskOwners)
      ? (source.subOwners ?? source.subTaskOwners).map((name) => String(name || "").trim()).filter(Boolean)
      : [],
    input: String(source.input ?? source.inputs ?? source.requiredInput ?? "").trim(),
    output: String(source.output ?? source.outputs ?? source.expectedOutput ?? "").trim(),
    files: normalizeFilePlan(source.files ?? source.fileChanges ?? source.filePlan),
  };
}

export function parseTaskChecklistFromModelOutput(text = "", locale = LOCALE.ZH_CN) {
  const parsed = extractJsonObjectFromText(text);
  if (Array.isArray(parsed)) {
    return parsed.map((item, index) => normalizeChecklistItem(item, index, locale));
  }
  if (parsed && typeof parsed === "object") {
    const checklist = Array.isArray(parsed.taskChecklist)
      ? parsed.taskChecklist
      : Array.isArray(parsed.tasks)
        ? parsed.tasks
        : null;
    if (checklist) {
      return checklist.map((item, index) => normalizeChecklistItem(item, index, locale));
    }
  }
  return [];
}

export function parseRefinementChecklistFromModelOutput(text = "", locale = LOCALE.ZH_CN) {
  const parsed = extractJsonObjectFromText(text);
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return [];
  const checklist = Array.isArray(parsed.refinementChecklist) ? parsed.refinementChecklist : null;
  if (!checklist) return [];
  return checklist.map((item, index) => normalizeChecklistItem(item, index, locale));
}

export function parseChecklistFromWrappedPayload(text = "", locale = LOCALE.ZH_CN) {
  const parsed = extractJsonObjectFromText(text);
  if (!parsed || typeof parsed !== "object") return [];

  const visited = new Set();
  const queue = [{ value: parsed, depth: 0 }];
  const candidateKeys = [
    "stdout",
    "stderr",
    "output",
    "content",
    "text",
    "result",
    "data",
    "payload",
    "toolResultText",
    "raw",
    "message",
  ];
  const candidateKeySet = new Set(candidateKeys);
  let queueIndex = 0;
  let nodeCount = 0;

  while (queueIndex < queue.length) {
    nodeCount += 1;
    if (nodeCount > WRAPPED_PAYLOAD_MAX_NODES) break;
    const current = queue[queueIndex++];
    const value = current?.value;
    const depth = Number(current?.depth || 0);
    if (value === null || value === undefined) continue;
    if (typeof value === "object") {
      if (visited.has(value)) continue;
      visited.add(value);
    }

    if (typeof value === "string") {
      const rawValue = String(value || "");
      const safeToParse =
        rawValue.length <= WRAPPED_PAYLOAD_MAX_STRING_LENGTH && CHECKLIST_HINT_RE.test(rawValue);
      const checklist = safeToParse ? parseTaskChecklistFromModelOutput(rawValue, locale) : [];
      if (checklist.length) return checklist;
      if (depth < WRAPPED_PAYLOAD_MAX_DEPTH) {
        const nested = extractJsonObjectFromText(rawValue);
        if (nested && typeof nested === "object") {
          queue.push({ value: nested, depth: depth + 1 });
        }
      }
      continue;
    }

    if (Array.isArray(value)) {
      const checklist = parseTaskChecklistFromModelOutput(JSON.stringify(value), locale);
      if (checklist.length) return checklist;
      if (depth < WRAPPED_PAYLOAD_MAX_DEPTH) {
        for (const item of value) {
          queue.push({ value: item, depth: depth + 1 });
        }
      }
      continue;
    }

    if (typeof value !== "object") continue;

    const checklist = parseTaskChecklistFromModelOutput(JSON.stringify(value), locale);
    if (checklist.length) return checklist;
    if (depth >= WRAPPED_PAYLOAD_MAX_DEPTH) continue;

    const entries = Object.entries(value);
    for (const key of candidateKeys) {
      const nested = value?.[key];
      if (nested !== undefined) queue.push({ value: nested, depth: depth + 1 });
    }
    for (const [key, nested] of entries) {
      if (!candidateKeySet.has(String(key || "").trim()) && nested && typeof nested === "object") {
        queue.push({ value: nested, depth: depth + 1 });
      }
    }
  }

  return [];
}

export function parseChecklistFromPlainText(text = "", locale = LOCALE.ZH_CN) {
  const raw = String(text || "").trim();
  if (!raw) return [];
  const lines = raw
    .replace(STRIP_FENCED_BLOCK_RE, "")
    .split(/\r?\n/)
    .map((line) => String(line || "").trim())
    .filter(Boolean);
  if (!lines.length) return [];

  const matched = [];
  for (const line of lines) {
    const numbered = line.match(/^\s*(\d+)\s*[\.、\)\-:：]\s*(.+)$/);
    const checkbox = line.match(/^\s*[-*+]\s*(?:\[[ xX]\]\s*)?(.+)$/);
    const step = line.match(/^\s*第?\s*(\d+)\s*步\s*[:：]?\s*(.+)$/);
    const detail = (numbered?.[2] || step?.[2] || checkbox?.[1] || "").trim();
    if (!detail) continue;
    matched.push({
      index: Number(numbered?.[1] || step?.[1] || matched.length + 1),
      task: detail,
    });
  }

  if (!matched.length || matched.length < 2) return [];
  const owner = getDefaultTaskOwner(locale);
  return matched.map((item, index) => ({
    index: Number.isFinite(Number(item.index)) ? Number(item.index) : index + 1,
    task: String(item.task || "").trim() || `${locale === LOCALE.EN_US ? "Task" : "任务"} ${index + 1}`,
    owner,
    subOwners: [],
  }));
}

export function parseChecklistWithLocalRepair(text = "", locale = LOCALE.ZH_CN) {
  const raw = String(text || "").trim();
  if (!raw) return [];
  const parsedDirect = parseTaskChecklistFromModelOutput(raw, locale);
  if (parsedDirect.length) return parsedDirect;
  const sanitized = sanitizeJsonCandidate(raw);
  if (sanitized && sanitized !== raw) {
    const repaired = parseTaskChecklistFromModelOutput(sanitized, locale);
    if (repaired.length) return repaired;
  }
  const wrapped = parseChecklistFromWrappedPayload(raw, locale);
  if (wrapped.length) return wrapped;
  return parseChecklistFromPlainText(raw, locale);
}

export function buildPlanSnapshot(bucket = {}, locale = LOCALE.ZH_CN) {
  const source = bucket && typeof bucket === "object" ? bucket : {};
  return {
    totalGoal: String(source.totalGoal || "").trim(),
    taskOwner: String(source.taskOwner || getDefaultTaskOwner(locale)).trim() || getDefaultTaskOwner(locale),
    nextPhase: source.nextPhase && typeof source.nextPhase === "object" ? source.nextPhase : null,
    checklistSource: String(source.taskChecklistSource || "").trim(),
    revisionCount: Array.isArray(source.planRevisions) ? source.planRevisions.length : 0,
  };
}

export function defaultTaskChecklist(locale = LOCALE.ZH_CN) {
  const owner = getDefaultTaskOwner(locale);
  const template = getTaskTemplate(locale);
  const emptyFiles = () => ({ create: [], modify: [], delete: [] });
  return [
    { index: 1, task: template.PARSE_ATTACHMENT, owner, subOwners: [], input: "user attachments/context", output: "parsed attachment/context data", files: emptyFiles() },
    { index: 2, task: template.EXECUTE_CORE, owner, subOwners: [], input: "task requirements and parsed data", output: "core task result", files: emptyFiles() },
    {
      index: 3,
      task: template.START_SUBTASK,
      owner,
      subOwners: getDefaultSubtaskOwners(locale),
      input: "delegable subtasks",
      output: "started subtask records",
      files: emptyFiles(),
    },
    { index: 4, task: template.WAIT_SUBTASK_RESULT, owner, subOwners: [], input: "started subtask records", output: "merged subtask results", files: emptyFiles() },
  ];
}
