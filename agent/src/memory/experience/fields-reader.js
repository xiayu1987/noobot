/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import {
  BUILTIN_EXPERIENCE_FIELDS,
  parseExperienceFieldsText,
} from "@noobot/memory-protocol/experience/fields";

export async function readExperienceFields(storage, basePath = "") {
  if (!basePath) return { fields: BUILTIN_EXPERIENCE_FIELDS, fieldsError: null };
  const fieldsPath = storage.experienceFieldsPath(basePath);
  if (!(await storage.fileExists(fieldsPath))) {
    return { fields: BUILTIN_EXPERIENCE_FIELDS, fieldsError: null };
  }
  try {
    return {
      fields: parseExperienceFieldsText(await storage.readText(fieldsPath, "")),
      fieldsError: null,
    };
  } catch (error) {
    return { fields: BUILTIN_EXPERIENCE_FIELDS, fieldsError: error };
  }
}
