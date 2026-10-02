/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { WORKSPACE_LAYOUT } from "./layout.js";

export const WORKSPACE_OPERATION = Object.freeze({
  CREATE: "create",
  REPAIR: "repair",
  SYNC: "sync",
  RESET: "reset",
});

export const WORKSPACE_SECTION = Object.freeze({
  MEMORY: "memory",
  RUNTIME: "runtime",
  SERVICE: "service",
  SKILL: "skill",
  CONFIG: "config",
});

export const WORKSPACE_SECTION_OWNER = Object.freeze({
  MEMORY_PROTOCOL: "memory-protocol",
  CONFIG_PROTOCOL: "agent-config-protocol",
  WORKSPACE_LAYOUT: "workspace-layout",
  ASSET_PACKAGE: "asset-package",
});

export const WORKSPACE_SECTIONS = Object.freeze({
  [WORKSPACE_SECTION.MEMORY]: Object.freeze({
    owner: WORKSPACE_SECTION_OWNER.MEMORY_PROTOCOL,
    paths: Object.freeze([WORKSPACE_LAYOUT.MEMORY_DIR]),
    backupOnReset: true,
    preserveOnReset: Object.freeze([]),
  }),
  [WORKSPACE_SECTION.RUNTIME]: Object.freeze({
    owner: WORKSPACE_SECTION_OWNER.WORKSPACE_LAYOUT,
    paths: Object.freeze([WORKSPACE_LAYOUT.RUNTIME_DIR]),
    backupOnReset: false,
    preserveOnReset: Object.freeze([
      WORKSPACE_LAYOUT.MEMORY_REPAIR_BACKUPS_DIR,
      WORKSPACE_LAYOUT.WORKSPACE_BACKUPS_DIR,
      WORKSPACE_LAYOUT.ASSET_STATE_FILE,
    ]),
  }),
  [WORKSPACE_SECTION.SERVICE]: Object.freeze({
    owner: WORKSPACE_SECTION_OWNER.ASSET_PACKAGE,
    paths: Object.freeze([WORKSPACE_LAYOUT.SERVICES_DIR]),
    backupOnReset: true,
    preserveOnReset: Object.freeze([]),
  }),
  [WORKSPACE_SECTION.SKILL]: Object.freeze({
    owner: WORKSPACE_SECTION_OWNER.ASSET_PACKAGE,
    paths: Object.freeze([WORKSPACE_LAYOUT.SKILLS_DIR]),
    backupOnReset: true,
    preserveOnReset: Object.freeze([]),
  }),
  [WORKSPACE_SECTION.CONFIG]: Object.freeze({
    owner: WORKSPACE_SECTION_OWNER.CONFIG_PROTOCOL,
    paths: Object.freeze([WORKSPACE_LAYOUT.CONFIG_FILE]),
    retiredPaths: Object.freeze([WORKSPACE_LAYOUT.RETIRED_CONFIG_EXAMPLE_FILE]),
    backupOnReset: true,
    preserveOnReset: Object.freeze([]),
  }),
});

export const WORKSPACE_ASSET_SECTIONS = Object.freeze(
  Object.entries(WORKSPACE_SECTIONS)
    .filter(([, section]) => section.owner === WORKSPACE_SECTION_OWNER.ASSET_PACKAGE)
    .map(([name]) => name),
);

export function normalizeWorkspaceSections(input = []) {
  const all = Object.keys(WORKSPACE_SECTIONS);
  if (!Array.isArray(input) || !input.length) return all;
  const normalized = [
    ...new Set(
      input
        .map((item) =>
          String(item ?? "")
            .trim()
            .toLowerCase(),
        )
        .filter(Boolean),
    ),
  ];
  const invalid = normalized.filter((item) => !all.includes(item));
  if (invalid.length) {
    const error = new TypeError(`invalid workspace sections: ${invalid.join(", ")}`);
    error.code = "WORKSPACE_SECTIONS_INVALID";
    error.details = { invalid, allowed: all };
    throw error;
  }
  return normalized;
}
