/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
const structureField = (key, type) => Object.freeze({ key, type });

export const EXPERIENCE_STRUCTURE_FIELDS = Object.freeze({
  domain: structureField("domain", "sanitized"),
  new: structureField("new", "boolean"),
  category: structureField("category", "sanitized"),
  subcategory: structureField("subcategory", "sanitized"),
});
