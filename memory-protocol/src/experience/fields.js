/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { MEMORY_DOCUMENT_KIND, readMemoryDocumentBody, renderMemoryDocument } from "../document.js";
import { EXPERIENCE_STRUCTURE_FIELDS } from "./structure.js";
import { text } from "@noobot/shared/value";
import { tMemory } from "../locale.js";

const EXPERIENCE_STAGES = Object.freeze(["daily", "weekly", "monthly", "yearly"]);

const FIELD_KEY_PATTERN = /^[a-z][a-z0-9_]{0,39}$/;

function contentField(key, title, description) {
  return Object.freeze({ key, title, description });
}

export function createBuiltinExperienceFields(locale) {
  const definition = {
    daily: ["experiences", "lessons"],
    weekly: ["experiences", "lessons"],
    monthly: ["patterns", "methodologies"],
    yearly: ["principles", "reflections"],
  };
  return Object.freeze(
    Object.fromEntries(
      Object.entries(definition).map(([stage, keys]) => [
        stage,
        Object.freeze(
          keys.map((key) =>
            contentField(
              key,
              tMemory(`experience.${stage}.${key}.title`, locale),
              tMemory(`experience.${stage}.${key}.description`, locale),
            ),
          ),
        ),
      ]),
    ),
  );
}

export const BUILTIN_EXPERIENCE_FIELDS = createBuiltinExperienceFields();

function cleanCell(value) {
  return String(value ?? "")
    .replace(/[|\r\n]+/g, " ")
    .trim();
}

function createExperienceFields(definition = {}) {
  const out = {};
  for (const stage of EXPERIENCE_STAGES) {
    const items = Array.isArray(definition?.[stage]) ? definition[stage] : [];
    if (!items.length) throw new Error(`experience fields stage ${stage} has no fields`);
    const seen = new Set();
    out[stage] = Object.freeze(
      items.map((item) => {
        const key = text(item?.key);
        if (!FIELD_KEY_PATTERN.test(key)) {
          throw new Error(`invalid experience field key in ${stage}: ${key || "(empty)"}`);
        }
        if (Object.hasOwn(EXPERIENCE_STRUCTURE_FIELDS, key)) {
          throw new Error(`experience field key is reserved in ${stage}: ${key}`);
        }
        if (seen.has(key)) throw new Error(`duplicate experience field in ${stage}: ${key}`);
        seen.add(key);
        return contentField(key, cleanCell(item?.title) || key, cleanCell(item?.description));
      }),
    );
  }
  return Object.freeze(out);
}

export function parseExperienceFieldsText(inputText = "") {
  const body = readMemoryDocumentBody(MEMORY_DOCUMENT_KIND.EXPERIENCE_FIELDS, inputText);
  const definition = {};
  let stage = "";
  for (const [index, rawLine] of body.split("\n").entries()) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const stageMatch = line.match(/^STAGE:\s*(\S+)$/);
    if (stageMatch) {
      stage = stageMatch[1].toLowerCase();
      if (!EXPERIENCE_STAGES.includes(stage)) {
        throw new Error(`unknown experience fields stage at line ${index + 1}: ${stage}`);
      }
      if (definition[stage]) throw new Error(`duplicate experience fields stage: ${stage}`);
      definition[stage] = [];
      continue;
    }
    if (!line.startsWith("-")) {
      throw new Error(`invalid experience fields line ${index + 1}: ${line}`);
    }
    if (!stage) throw new Error(`experience field before STAGE at line ${index + 1}`);
    const [key = "", title = "", ...description] = line.slice(1).split("|");
    definition[stage].push({
      key: key.trim(),
      title: title.trim(),
      description: description.join("|").trim(),
    });
  }
  return createExperienceFields(definition);
}

export function renderExperienceFieldsText(fields = BUILTIN_EXPERIENCE_FIELDS) {
  const blocks = EXPERIENCE_STAGES.map((stage) =>
    [
      `STAGE: ${stage}`,
      ...fields[stage].map((item) =>
        `- ${item.key} | ${item.title} | ${item.description}`.trimEnd().replace(/\s*\|$/, ""),
      ),
    ].join("\n"),
  );
  return renderMemoryDocument(MEMORY_DOCUMENT_KIND.EXPERIENCE_FIELDS, blocks.join("\n\n"));
}
