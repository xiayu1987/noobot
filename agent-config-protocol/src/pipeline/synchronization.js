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

export const CONFIG_OPEN_OBJECT_PATHS = Object.freeze([
  "mcp_servers",
  "plugins",
  "providers",
  "scenarios",
  "services",
]);

function projectTemplateValues({ template, target, excludedRootKeys, openObjectPaths, path = [] }) {
  if (!isPlainObject(template)) return structuredClone(target);
  const targetObject = isPlainObject(target) ? target : {};
  const output = {};
  const depth = path.length;

  for (const [key, templateValue] of Object.entries(template)) {
    if (depth === 0 && excludedRootKeys.has(key)) continue;
    if (!Object.prototype.hasOwnProperty.call(targetObject, key)) {
      output[key] = structuredClone(templateValue);
      continue;
    }
    if (isPlainObject(templateValue) && isPlainObject(targetObject[key])) {
      output[key] = projectTemplateValues({
        template: templateValue,
        target: targetObject[key],
        excludedRootKeys,
        openObjectPaths,
        path: [...path, key],
      });
      continue;
    }
    output[key] = structuredClone(targetObject[key]);
  }

  const currentPath = path.join(".");
  if (openObjectPaths.has(currentPath)) {
    for (const [key, value] of Object.entries(targetObject)) {
      if (!Object.prototype.hasOwnProperty.call(output, key)) output[key] = structuredClone(value);
    }
  }
  if (depth === 0) {
    for (const key of excludedRootKeys) {
      if (Object.prototype.hasOwnProperty.call(targetObject, key)) {
        output[key] = structuredClone(targetObject[key]);
      }
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
  const openObjectPaths = new Set(CONFIG_OPEN_OBJECT_PATHS);
  return migrateConfigFileToCurrentProtocol(
    projectTemplateValues({
      template: currentTemplate,
      target: currentTarget,
      excludedRootKeys: excluded,
      openObjectPaths,
    }),
  );
}
