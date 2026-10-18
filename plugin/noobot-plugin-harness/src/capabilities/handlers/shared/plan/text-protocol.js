/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

import { text, isPlainObject } from "@noobot/shared/value";

const MAIN_PLAN_LINE = /^\s*(?<mainId>\d+)\.\s+(?<content>.+?)\s*$/;
const SUB_PLAN_LINE = /^\s*(?<mainId>\d+)\.(?<subIndex>\d+)\.?\s+(?<content>.+?)\s*$/;
const PATCH_ADD_UPDATE =
  /^\s*(?<action>ADD|UPDATE)\s+(?<target>[[\]\d.\s]+)\s+(?<content>.+?)\s*$/i;
const PATCH_DELETE = /^\s*(?<action>DELETE)\s+(?<target>[[\]\d.\s]+)\s*$/i;
const PATCH_LINE_PATTERNS = Object.freeze([PATCH_ADD_UPDATE, PATCH_DELETE]);

function normalizeText(inputText = "") {
  return String(inputText || "")
    .replace(/\r\n?/g, "\n")
    .trim();
}

function splitLines(sourceText = "") {
  return normalizeText(sourceText)
    .split("\n")
    .map((line) => text(line))
    .filter(Boolean);
}

function ensurePlanDocumentShape(planDocument = null) {
  const doc = planDocument && typeof planDocument === "object" ? planDocument : {};
  if (!Array.isArray(doc.mainPlans)) doc.mainPlans = [];
  if (!isPlainObject(doc.subPlansByMainId)) {
    doc.subPlansByMainId = {};
  }
  return doc;
}

function normalizeMainPlans(mainPlans = []) {
  const map = new Map();
  for (const item of Array.isArray(mainPlans) ? mainPlans : []) {
    const id = Number(item?.id);
    const content = text(item?.content);
    if (!Number.isFinite(id) || !content) continue;
    map.set(id, { id, content });
  }
  return [...map.values()].sort((a, b) => a.id - b.id);
}

function normalizeSubPlans(subPlans = [], mainId = 0) {
  const map = new Map();
  for (const item of Array.isArray(subPlans) ? subPlans : []) {
    const subIndex = Number(item?.subIndex);
    const content = text(item?.content);
    if (!Number.isFinite(subIndex) || subIndex <= 0 || !content) continue;
    map.set(subIndex, {
      id: `${mainId}.${subIndex}`,
      mainId,
      subIndex,
      content,
    });
  }
  return [...map.values()].sort((a, b) => a.subIndex - b.subIndex);
}

function parseId(rawId = "") {
  const raw = text(rawId);
  if (/\]\s*\.\s*\[/.test(raw)) return null;
  const normalizedText = text(rawId).replace(/[\[\]\s]/g, "");
  if (!normalizedText) return null;
  const parts = normalizedText.split(".");
  if (parts.length === 0) return null;
  const [mainPart, subPart] = parts;
  const mainId = Number(mainPart);
  if (!Number.isFinite(mainId)) return null;
  if (subPart === undefined)
    return {
      raw: normalizedText,
      mainId,
      subIndex: null,
      isSub: false,
      depth: 1,
      segments: [mainId],
    };
  const numericParts = parts.map((item) => Number(item));
  if (numericParts.some((item) => !Number.isFinite(item))) return null;
  const subIndex = Number(subPart);
  if (!Number.isFinite(subIndex)) return null;
  return {
    raw: normalizedText,
    mainId,
    subIndex,
    isSub: true,
    depth: parts.length,
    segments: numericParts,
  };
}

function upsertMainPlan(doc = {}, mainId = 0, content = "") {
  const normalizedContent = text(content);
  if (!Number.isFinite(mainId) || mainId <= 0 || !normalizedContent) return false;
  const current = ensurePlanDocumentShape(doc);
  const index = current.mainPlans.findIndex((item = {}) => Number(item.id) === Number(mainId));
  if (index >= 0) {
    current.mainPlans[index] = { id: Number(mainId), content: normalizedContent };
  } else {
    current.mainPlans.push({ id: Number(mainId), content: normalizedContent });
  }
  current.mainPlans = normalizeMainPlans(current.mainPlans);
  return true;
}

function deleteMainPlan(doc = {}, mainId = 0) {
  if (!Number.isFinite(mainId) || mainId <= 0) return false;
  const current = ensurePlanDocumentShape(doc);
  const beforeLength = current.mainPlans.length;
  current.mainPlans = current.mainPlans.filter((item = {}) => Number(item.id) !== Number(mainId));
  delete current.subPlansByMainId[String(mainId)];
  return current.mainPlans.length !== beforeLength;
}

function upsertSubPlan(doc = {}, mainId = 0, subIndex = 0, content = "") {
  const normalizedContent = text(content);
  if (
    !Number.isFinite(mainId) ||
    mainId <= 0 ||
    !Number.isFinite(subIndex) ||
    subIndex <= 0 ||
    !normalizedContent
  ) {
    return false;
  }
  const current = ensurePlanDocumentShape(doc);
  const key = String(mainId);
  const currentList = Array.isArray(current.subPlansByMainId[key])
    ? current.subPlansByMainId[key]
    : [];
  const index = currentList.findIndex((item = {}) => Number(item.subIndex) === Number(subIndex));
  const nextItem = {
    id: `${mainId}.${subIndex}`,
    mainId: Number(mainId),
    subIndex: Number(subIndex),
    content: normalizedContent,
  };
  if (index >= 0) currentList[index] = nextItem;
  else currentList.push(nextItem);
  current.subPlansByMainId[key] = normalizeSubPlans(currentList, Number(mainId));
  return true;
}

function deleteSubPlan(doc = {}, mainId = 0, subIndex = 0) {
  if (!Number.isFinite(mainId) || mainId <= 0 || !Number.isFinite(subIndex) || subIndex <= 0)
    return false;
  const current = ensurePlanDocumentShape(doc);
  const key = String(mainId);
  const currentList = Array.isArray(current.subPlansByMainId[key])
    ? current.subPlansByMainId[key]
    : [];
  const next = currentList.filter((item = {}) => Number(item.subIndex) !== Number(subIndex));
  current.subPlansByMainId[key] = normalizeSubPlans(next, Number(mainId));
  return next.length !== currentList.length;
}

function parsePatchLine(line) {
  const match = PATCH_LINE_PATTERNS.map((pattern) => line.match(pattern)).find(Boolean);
  if (!match) return null;
  const { action, target: rawTarget, content: rawContent } = match.groups;
  const target = parseId(rawTarget);
  const normalizedAction = text(action).toUpperCase();
  const isDelete = normalizedAction === "DELETE";
  const content = isDelete ? "" : text(rawContent);
  if (!target || (!isDelete && !content)) return { command: null };
  return { command: { action: normalizedAction, target, content, raw: line } };
}

function applyPatchCommand(doc, { action, target, content }) {
  if (action === "DELETE") {
    return target.isSub
      ? deleteSubPlan(doc, target.mainId, target.subIndex)
      : deleteMainPlan(doc, target.mainId);
  }
  return target.isSub
    ? upsertSubPlan(doc, target.mainId, target.subIndex, content)
    : upsertMainPlan(doc, target.mainId, content);
}

export function parsePlanDocumentFromText(inputText = "") {
  const doc = ensurePlanDocumentShape({});
  for (const line of splitLines(inputText)) {
    const patchLine = parsePatchLine(line);
    if (patchLine) {
      if (patchLine.command) applyPatchCommand(doc, patchLine.command);
      continue;
    }
    const subMatch = line.match(SUB_PLAN_LINE);
    if (subMatch) {
      const { mainId, subIndex, content } = subMatch.groups;
      upsertSubPlan(doc, Number(mainId), Number(subIndex), content);
      continue;
    }
    const mainMatch = line.match(MAIN_PLAN_LINE);
    if (!mainMatch) continue;
    const { mainId, content } = mainMatch.groups;
    upsertMainPlan(doc, Number(mainId), content);
  }
  return ensurePlanDocumentShape(doc);
}

export function renderPlanDocument(planDocument = null) {
  const doc = ensurePlanDocumentShape(planDocument);
  doc.mainPlans = normalizeMainPlans(doc.mainPlans);
  const lines = [];
  for (const main of doc.mainPlans) {
    lines.push(`${main.id}. ${main.content}`);
    const subList = normalizeSubPlans(doc.subPlansByMainId[String(main.id)], Number(main.id));
    doc.subPlansByMainId[String(main.id)] = subList;
    for (const sub of subList) {
      lines.push(`${sub.id} ${sub.content}`);
    }
  }
  return lines.join("\n").trim();
}

export function parseMainPlansFromPlanText(inputText = "") {
  return parsePlanDocumentFromText(inputText).mainPlans;
}

export function parseSubPlansFromPlanText(inputText = "", mainId = 0) {
  const doc = parsePlanDocumentFromText(inputText);
  return normalizeSubPlans(doc.subPlansByMainId[String(mainId)], Number(mainId));
}

export function parsePatchCommands(rawText = "") {
  const commands = [];
  for (const line of splitLines(rawText)) {
    const command = parsePatchLine(line)?.command;
    if (command) commands.push(command);
  }
  return commands;
}

function isCommandInStageScope(doc = {}, target = {}, { isRefinement, targetMainIds }) {
  if (!isRefinement) return target.isSub !== true;
  return (
    target.isSub === true &&
    target.depth === 2 &&
    targetMainIds.has(target.mainId) &&
    doc.mainPlans.some((item = {}) => item.id === target.mainId)
  );
}

export function applyPatchCommandsToPlanDocument(
  planDocument = null,
  patchText = "",
  { stage = "revision", targetMainStepIndexes = [] } = {},
) {
  const doc = ensurePlanDocumentShape(planDocument);
  const commands = parsePatchCommands(patchText);
  const scope = {
    isRefinement: stage === "refinement",
    targetMainIds: new Set(targetMainStepIndexes.map(Number)),
  };
  let changed = false;
  for (const command of commands) {
    if (!isCommandInStageScope(doc, command.target, scope)) continue;
    changed = applyPatchCommand(doc, command) || changed;
  }
  return { changed, commands };
}
