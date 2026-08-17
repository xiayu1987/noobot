/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { migrateConfigFileToCurrentProtocol } from "./migration.js";
import { isPlainObject } from "../utils.js";

export const DEPLOYMENT_OWNED_CONFIG_ROOT_KEYS = Object.freeze([
  "workspace_root",
  "workspaceRoot",
  "workspace_template_path",
  "workspaceTemplatePath",
  "super_admin",
  "superAdmin",
]);

function mergeMissingTemplateValues({ template, target, excludedRootKeys, depth = 0 }) {
  if (!isPlainObject(template)) return structuredClone(target);
  const targetObject = isPlainObject(target) ? target : {};
  const output = structuredClone(targetObject);

  for (const [key, templateValue] of Object.entries(template)) {
    if (depth === 0 && excludedRootKeys.has(key)) continue;
    if (!Object.prototype.hasOwnProperty.call(targetObject, key)) {
      output[key] = structuredClone(templateValue);
      continue;
    }
    if (isPlainObject(templateValue) && isPlainObject(targetObject[key])) {
      output[key] = mergeMissingTemplateValues({
        template: templateValue,
        target: targetObject[key],
        excludedRootKeys,
        depth: depth + 1,
      });
    }
  }
  return output;
}

export function synchronizeConfigFileFromTemplate({
  template = {},
  target = {},
  excludedRootKeys = [],
} = {}) {
  const currentTemplate = migrateConfigFileToCurrentProtocol(template);
  const currentTarget = migrateConfigFileToCurrentProtocol(target);
  const excluded = new Set(
    Array.from(excludedRootKeys || [], (key) => String(key || "").trim()).filter(Boolean),
  );
  return migrateConfigFileToCurrentProtocol(
    mergeMissingTemplateValues({
      template: currentTemplate,
      target: currentTarget,
      excludedRootKeys: excluded,
    }),
  );
}
