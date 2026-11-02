/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import {
  createBuiltinExperienceFields,
  parseExperienceFieldsText,
} from "@noobot/memory-protocol/experience/fields";

export async function readExperienceFields(storage, basePath = "", locale) {
  const builtinFields = createBuiltinExperienceFields(locale);
  if (!basePath) return { fields: builtinFields, fieldsError: null };
  const fieldsPath = storage.experienceFieldsPath(basePath);
  if (!(await storage.fileExists(fieldsPath))) {
    return { fields: builtinFields, fieldsError: null };
  }
  try {
    return {
      fields: parseExperienceFieldsText(await storage.readText(fieldsPath, "")),
      fieldsError: null,
    };
  } catch (error) {
    return { fields: builtinFields, fieldsError: error };
  }
}
