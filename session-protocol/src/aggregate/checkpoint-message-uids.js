/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { isCanonicalText } from "@noobot/shared/value";
import { isDeepFrozen } from "@noobot/shared/deep-freeze";

const validatedImmutableUidLists = new WeakSet();

export function requireCheckpointMessageUids(values, field, invalid) {
  if (!Array.isArray(values)) throw invalid(`${field} must be an array`);
  if (validatedImmutableUidLists.has(values)) return values;
  const itemField = `${field}[] must be a non-empty trimmed string`;
  values.forEach((uid) => {
    if (!isCanonicalText(uid)) throw invalid(itemField);
  });
  if (new Set(values).size !== values.length) throw invalid(`${field} must not contain duplicates`);
  if (isDeepFrozen(values)) validatedImmutableUidLists.add(values);
  return values;
}
