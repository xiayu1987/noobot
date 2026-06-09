/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

const MAIN_PLAN_LINE = /^\s*(\d+)\.\s+(.+?)\s*$/;
const SUB_PLAN_LINE = /^\s*(\d+)\.(\d+)\.?\s+(.+?)\s*$/;
const PATCH_ADD_UPDATE = /^\s*(ADD|UPDATE)\s+([[\]\d.\s]+)\s+(.+?)\s*$/i;
const PATCH_DELETE = /^\s*(DELETE)\s+([[\]\d.\s]+)\s*$/i;

function normalizeText(text = "") {
  return String(text || "")
    .replace(/\r\n?/g, "\n")
    .trim();
}

function splitLines(text = "") {
  return normalizeText(text)
    .split("\n")
    .map((line) => String(line || "").trim())
    .filter(Boolean);
}

function ensurePlanDocumentShape(planDocument = null) {
  const doc = planDocument && typeof planDocument === "object" ? planDocument : {};
  if (!Array.isArray(doc.mainPlans)) doc.mainPlans = [];
  if (!doc.subPlansByMainId || typeof doc.subPlansByMainId !== "object" || Array.isArray(doc.subPlansByMainId)) {
    doc.subPlansByMainId = {};
  }
  return doc;
}

function normalizeMainPlans(mainPlans = []) {
  const map = new Map();
  for (const item of Array.isArray(mainPlans) ? mainPlans : []) {
    const id = Number(item?.id);
    const content = String(item?.content || "").trim();
    if (!Number.isFinite(id) || !content) continue;
    map.set(id, { id, content });
  }
  return [...map.values()].sort((a, b) => a.id - b.id);
}

function normalizeSubPlans(subPlans = [], mainId = 0) {
  const map = new Map();
  for (const item of Array.isArray(subPlans) ? subPlans : []) {
    const subIndex = Number(item?.subIndex);
    const content = String(item?.content || "").trim();
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
  const raw = String(rawId || "").trim();
  if (/\]\s*\.\s*\[/.test(raw)) return null;
  const text = String(rawId || "")
    .trim()
    .replace(/[\[\]\s]/g, "");
  if (!text) return null;
  const parts = text.split(".");
  if (parts.length === 0) return null;
  const [mainPart, subPart] = parts;
  const mainId = Number(mainPart);
  if (!Number.isFinite(mainId)) return null;
  if (subPart === undefined) return { raw: text, mainId, subIndex: null, isSub: false, depth: 1, segments: [mainId] };
  const numericParts = parts.map((item) => Number(item));
  if (numericParts.some((item) => !Number.isFinite(item))) return null;
  const subIndex = Number(subPart);
  if (!Number.isFinite(subIndex)) return null;
  return {
    raw: text,
    mainId,
    subIndex,
    isSub: true,
    depth: parts.length,
    segments: numericParts,
  };
}

function upsertMainPlan(doc = {}, mainId = 0, content = "") {
  const normalizedContent = String(content || "").trim();
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

function ensureMainPlanPlaceholder(doc = {}, mainId = 0) {
  if (!Number.isFinite(mainId) || mainId <= 0) return false;
  if (doc.mainPlans.some((item = {}) => Number(item.id) === Number(mainId))) return true;
  return upsertMainPlan(doc, mainId, `main plan ${mainId}`);
}

function upsertSubPlan(
  doc = {},
  mainId = 0,
  subIndex = 0,
  content = "",
  { ensureMainPlaceholder = true } = {},
) {
  const normalizedContent = String(content || "").trim();
  if (!Number.isFinite(mainId) || mainId <= 0 || !Number.isFinite(subIndex) || subIndex <= 0 || !normalizedContent) {
    return false;
  }
  const current = ensurePlanDocumentShape(doc);
  if (ensureMainPlaceholder) {
    ensureMainPlanPlaceholder(current, mainId);
  }
  const key = String(mainId);
  const currentList = Array.isArray(current.subPlansByMainId[key]) ? current.subPlansByMainId[key] : [];
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
  if (!Number.isFinite(mainId) || mainId <= 0 || !Number.isFinite(subIndex) || subIndex <= 0) return false;
  const current = ensurePlanDocumentShape(doc);
  const key = String(mainId);
  const currentList = Array.isArray(current.subPlansByMainId[key]) ? current.subPlansByMainId[key] : [];
  const next = currentList.filter((item = {}) => Number(item.subIndex) !== Number(subIndex));
  current.subPlansByMainId[key] = normalizeSubPlans(next, Number(mainId));
  return next.length !== currentList.length;
}

function hasSubPlan(doc = {}, mainId = 0, subIndex = 0) {
  if (!Number.isFinite(mainId) || !Number.isFinite(subIndex) || mainId <= 0 || subIndex <= 0) return false;
  const current = ensurePlanDocumentShape(doc);
  const key = String(mainId);
  const currentList = Array.isArray(current.subPlansByMainId[key]) ? current.subPlansByMainId[key] : [];
  return currentList.some((item = {}) => Number(item.subIndex) === Number(subIndex));
}

function allocateNextSubPlanIndex(doc = {}, mainId = 0) {
  if (!Number.isFinite(mainId) || mainId <= 0) return 1;
  const current = ensurePlanDocumentShape(doc);
  const key = String(mainId);
  const currentList = Array.isArray(current.subPlansByMainId[key]) ? current.subPlansByMainId[key] : [];
  const used = new Set(
    currentList
      .map((item = {}) => Number(item.subIndex))
      .filter((item) => Number.isFinite(item) && item > 0),
  );
  let candidate = 1;
  while (used.has(candidate)) candidate += 1;
  return candidate;
}

export function parsePlanDocumentFromText(text = "") {
  const doc = ensurePlanDocumentShape({});
  for (const line of splitLines(text)) {
    const addOrUpdate = line.match(PATCH_ADD_UPDATE);
    if (addOrUpdate) {
      const action = String(addOrUpdate[1] || "").trim().toUpperCase();
      const target = parseId(addOrUpdate[2]);
      const content = String(addOrUpdate[3] || "").trim();
      if (!target || !content) continue;
      if (target.isSub) {
        if (action === "ADD" || action === "UPDATE") {
          upsertSubPlan(doc, Number(target.mainId), Number(target.subIndex), content, {
            ensureMainPlaceholder: false,
          });
        }
      } else if (action === "ADD" || action === "UPDATE") {
        upsertMainPlan(doc, Number(target.mainId), content);
      }
      continue;
    }
    const del = line.match(PATCH_DELETE);
    if (del) {
      const target = parseId(del[2]);
      if (!target) continue;
      if (target.isSub) deleteSubPlan(doc, Number(target.mainId), Number(target.subIndex));
      else deleteMainPlan(doc, Number(target.mainId));
      continue;
    }
    const subMatch = line.match(SUB_PLAN_LINE);
    if (subMatch) {
      const [, mainRaw, subRaw, contentRaw] = subMatch;
      upsertSubPlan(doc, Number(mainRaw), Number(subRaw), contentRaw, {
        ensureMainPlaceholder: false,
      });
      continue;
    }
    const mainMatch = line.match(MAIN_PLAN_LINE);
    if (!mainMatch) continue;
    const [, idRaw, contentRaw] = mainMatch;
    upsertMainPlan(doc, Number(idRaw), contentRaw);
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

export function parseMainPlansFromPlanText(text = "") {
  return parsePlanDocumentFromText(text).mainPlans;
}

export function parseSubPlansFromPlanText(text = "", mainId = 0) {
  const doc = parsePlanDocumentFromText(text);
  return normalizeSubPlans(doc.subPlansByMainId[String(mainId)], Number(mainId));
}

export function parsePatchCommands(text = "") {
  const commands = [];
  for (const line of splitLines(text)) {
    const addOrUpdate = line.match(PATCH_ADD_UPDATE);
    if (addOrUpdate) {
      const action = String(addOrUpdate[1] || "").trim().toUpperCase();
      const target = parseId(addOrUpdate[2]);
      const content = String(addOrUpdate[3] || "").trim();
      if (!target || !content) continue;
      commands.push({ action, target, content, raw: line });
      continue;
    }
    const del = line.match(PATCH_DELETE);
    if (del) {
      const action = String(del[1] || "").trim().toUpperCase();
      const target = parseId(del[2]);
      if (!target) continue;
      commands.push({ action, target, content: "", raw: line });
    }
  }
  return commands;
}

export function applyPatchCommandsToPlanDocument(planDocument = null, patchText = "", { stage = "revision" } = {}) {
  const doc = ensurePlanDocumentShape(
    planDocument && typeof planDocument === "object" ? planDocument : {},
  );
  const commands = parsePatchCommands(patchText);
  if (!commands.length) return { changed: false, commands: [] };

  let changed = false;
  const isRefinement = String(stage || "").trim().toLowerCase() === "refinement";
  for (const command of commands) {
    const action = String(command.action || "").trim().toUpperCase();
    const target = command.target || {};
    const targetDepth = Number(target.depth || (target.isSub ? 2 : 1));
    const isDeepSubPlan = target.isSub === true && targetDepth > 2;
    if (isRefinement && target.isSub !== true) continue;
    if (!isRefinement && target.isSub === true) continue;
    if (action === "ADD" || action === "UPDATE") {
      if (target.isSub) {
        const isAdd = action === "ADD";
        const resolvedSubIndex =
          isRefinement &&
          ((isAdd && hasSubPlan(doc, target.mainId, target.subIndex)) || isDeepSubPlan)
            ? allocateNextSubPlanIndex(doc, target.mainId)
            : target.subIndex;
        changed = upsertSubPlan(doc, target.mainId, resolvedSubIndex, command.content) || changed;
      } else {
        changed = upsertMainPlan(doc, target.mainId, command.content) || changed;
      }
      continue;
    }
    if (action === "DELETE") {
      if (target.isSub) {
        if (isRefinement && isDeepSubPlan) continue;
        changed = deleteSubPlan(doc, target.mainId, target.subIndex) || changed;
      } else {
        changed = deleteMainPlan(doc, target.mainId) || changed;
      }
    }
  }
  return { changed, commands };
}
