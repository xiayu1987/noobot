/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { isPlainObject } from "./utils.js";

const RETIRED_CONFIG_PATHS = Object.freeze(
  [
    ["attachments", "attachment_models"],
    ["session", "use_last_running_task_range"],
    ["session", "use_last_completed_task_range"],
    ["tools", "set_skill_task"],
    ["tools", "web_to_data"],
    ["tools", "doc_to_data"],
    ["tools", "media_to_data"],
    ["tools", "process_content_task"],
    ["tools", "execute_script", "sandbox_mode"],
    ["tools", "execute_script", "sandbox_provider"],
  ].map((segments) => Object.freeze(segments)),
);

function deletePath(root, segments) {
  let node = root;
  const parents = [];
  for (let index = 0; index < segments.length - 1; index += 1) {
    if (!isPlainObject(node)) return;
    parents.push({ node, key: segments[index] });
    node = node[segments[index]];
    if (!isPlainObject(node)) return;
  }
  delete node[segments[segments.length - 1]];
  for (let index = parents.length - 1; index >= 0; index -= 1) {
    const parent = parents[index];
    const child = parent.node[parent.key];
    if (!isPlainObject(child) || Object.keys(child).length > 0) break;
    delete parent.node[parent.key];
  }
}

export function migrateConfigFileToCurrentProtocol(config = {}) {
  if (!isPlainObject(config)) return config;
  for (const segments of RETIRED_CONFIG_PATHS) deletePath(config, segments);
  return config;
}
