/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { resolveLocale } from "./i18n.js";
import { isPlainObject } from "@noobot/shared/value";
import { assertHarnessBucket, createHarnessBucket } from "../../../core/bucket-contract.js";

function ensureObjectField(target, key) {
  if (target[key] === undefined) target[key] = {};
  if (!isPlainObject(target[key])) throw new TypeError(`invalid_harness_object:${key}`);
  return target[key];
}

export function readHarnessBucket(ctx = {}) {
  const bucket = ctx?.agentContext?.bindings?.extensions?.harness;
  return bucket === undefined ? null : assertHarnessBucket(bucket);
}

export function ensureHarnessBucket(ctx = {}) {
  const agentContext = ctx?.agentContext;
  if (!agentContext) return null;
  if (!isPlainObject(agentContext)) throw new TypeError("invalid_harness_object:agentContext");
  const bindings = ensureObjectField(agentContext, "bindings");
  const extensions = ensureObjectField(bindings, "extensions");
  if (extensions.harness === undefined) extensions.harness = createHarnessBucket();
  const bucket = assertHarnessBucket(extensions.harness);
  const state = bucket.state;
  state.locale = resolveLocale(ctx);
  return { bucket, state };
}
