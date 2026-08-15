/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import {
  filePath,
  isAbsolutePathAnyPlatform,
  normalizePathForPlatform,
  normalizePathPlatform,
  normalizeSlashPath,
  PATH_PLATFORMS,
} from "./platform.mjs";

export const PATH_REF_VIEWS = Object.freeze({
  WORKSPACE: "workspace",
  HOST: "host",
  ATTACHMENT: "attachment",
  TASK_LOCAL: "task-local",
});
export const EXECUTION_PATH_VIEWS = Object.freeze({
  HOST: "host",
  SANDBOX: "sandbox",
  TASK_LOCAL: "task-local",
  SERVICE_LOCAL: "service-local",
});
export const DISPLAY_PATH_VIEWS = Object.freeze({
  LOGICAL: "logical",
  RUNTIME: "runtime",
  ATTACHMENT: "attachment",
  TASK_LOCAL: "task-local",
  NONE: "none",
});

export const PATH_CAPABILITIES = Object.freeze({
  FILE_READ: "file.read",
  FILE_WRITE: "file.write",
  FILE_PATCH: "file.patch",
  FILE_SEARCH: "file.search",
  DOCUMENT_INPUT: "document.input",
  MULTIMODAL_INPUT: "multimodal.input",
  SCRIPT_INPUT: "script.input",
  NATIVE_INPUT: "native.input",
});

export const PLATFORM_PROTECTED_ROOTS = deepFreeze({
  [PATH_PLATFORMS.LINUX]: ["/proc", "/sys", "/dev"],
  [PATH_PLATFORMS.MACOS]: ["/dev"],
  [PATH_PLATFORMS.WINDOWS]: [],
});

function deepFreeze(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  for (const item of Object.values(value)) deepFreeze(item);
  return Object.freeze(value);
}

function isPlainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function mergePolicy(base, override) {
  if (override === undefined) {
    if (Array.isArray(base)) return [...base];
    if (!isPlainObject(base)) return base;
    return Object.fromEntries(
      Object.entries(base).map(([key, value]) => [key, mergePolicy(value, undefined)]),
    );
  }
  if (!isPlainObject(base) || !isPlainObject(override)) {
    return Array.isArray(override) ? [...override] : override;
  }
  const output = mergePolicy(base, undefined);
  for (const [key, value] of Object.entries(override)) {
    output[key] = mergePolicy(base[key], value);
  }
  return output;
}

const DEFAULT_CAPABILITIES = {
  "file.read": { acceptedViews: ["workspace", "host"], hostRequiresRole: "super_admin" },
  "file.write": { acceptedViews: ["workspace", "host"], hostRequiresRole: "super_admin" },
  "file.patch": { acceptedViews: ["workspace", "host"], hostRequiresRole: "super_admin" },
  "file.search": { acceptedViews: ["workspace", "host"], hostRequiresRole: "super_admin" },
  "document.input": {
    acceptedViews: ["workspace", "attachment", "host"],
    hostRequiresRole: "super_admin",
  },
  "multimodal.input": {
    acceptedViews: ["workspace", "attachment", "host"],
    hostRequiresRole: "super_admin",
  },
  "script.input": { acceptedViews: ["workspace", "attachment"], hostRequiresRole: "deny" },
  "native.input": {
    acceptedViews: ["workspace", "attachment", "host"],
    hostRequiresRole: "super_admin",
  },
};

export const BUILTIN_PATH_POLICY = deepFreeze({
  roles: {
    regularUser: { workspace: { own: "read_write", others: "deny" }, host: { access: "deny" } },
    superAdmin: {
      workspace: { own: "read_write", others: "read_write" },
      host: {
        access: "allow",
        allowedRoots: ["<host-filesystem>"],
        deniedRoots: [],
      },
    },
  },
  capabilities: DEFAULT_CAPABILITIES,
  resolution: {
    followSymbolicLinks: false,
    requireRealPathForExistingTargets: true,
    validateWriteParentRealPath: true,
    rejectAmbiguousVirtualPaths: true,
    caseSensitivity: "platform",
  },
  display: {
    fileTools: "logical",
    scriptTools: "logical",
    nativeScript: "task-local",
    attachments: "identity",
    errors: "logical",
    audit: "execution",
  },
});

function canonicalRule(value = {}) {
  const acceptedViews = value.acceptedViews || value.accepted_views;
  const hostRequiresRole = value.hostRequiresRole || value.host_requires_role;
  const canonical = Object.fromEntries(
    Object.entries(value).filter(
      ([key]) => !["accepted_views", "host_requires_role"].includes(key),
    ),
  );
  return {
    ...canonical,
    ...(acceptedViews ? { acceptedViews } : {}),
    ...(hostRequiresRole ? { hostRequiresRole } : {}),
  };
}

function canonicalHostRule(value = {}) {
  const allowedRoots = value.allowedRoots || value.allowed_roots;
  const deniedRoots = value.deniedRoots || value.denied_roots;
  const canonical = Object.fromEntries(
    Object.entries(value).filter(([key]) => !["allowed_roots", "denied_roots"].includes(key)),
  );
  return {
    ...canonical,
    ...(allowedRoots ? { allowedRoots } : {}),
    ...(deniedRoots ? { deniedRoots } : {}),
  };
}

function canonicalResolution(value = {}) {
  const fields = {
    followSymbolicLinks: value.followSymbolicLinks ?? value.follow_symbolic_links,
    requireRealPathForExistingTargets:
      value.requireRealPathForExistingTargets ?? value.require_real_path_for_existing_targets,
    validateWriteParentRealPath:
      value.validateWriteParentRealPath ?? value.validate_write_parent_real_path,
    rejectAmbiguousVirtualPaths:
      value.rejectAmbiguousVirtualPaths ?? value.reject_ambiguous_virtual_paths,
    caseSensitivity: value.caseSensitivity || value.case_sensitivity,
  };
  const canonical = Object.fromEntries(
    Object.entries(value).filter(
      ([key]) =>
        ![
          "follow_symbolic_links",
          "require_real_path_for_existing_targets",
          "validate_write_parent_real_path",
          "reject_ambiguous_virtual_paths",
          "case_sensitivity",
        ].includes(key),
    ),
  );
  return {
    ...canonical,
    ...Object.fromEntries(Object.entries(fields).filter(([, item]) => item !== undefined)),
  };
}

function canonicalDisplay(value = {}) {
  const fields = {
    fileTools: value.fileTools ?? value.file_tools,
    scriptTools: value.scriptTools ?? value.script_tools,
    nativeScript: value.nativeScript ?? value.native_script,
  };
  const canonical = Object.fromEntries(
    Object.entries(value).filter(
      ([key]) => !["file_tools", "script_tools", "native_script"].includes(key),
    ),
  );
  const normalizedFields = Object.fromEntries(
    Object.entries(fields)
      .filter(([, item]) => item !== undefined)
      .map(([key, item]) => [key, item === "task_local" ? "task-local" : item]),
  );
  return { ...canonical, ...normalizedFields };
}

export const TOOL_PATH_CONTRACTS = Object.freeze({
  fileRead: Object.freeze({
    capability: "file.read",
    accepted: ["workspace", "host"],
    execution: ["host"],
    display: "runtime",
  }),
  fileWrite: Object.freeze({
    capability: "file.write",
    accepted: ["workspace", "host"],
    execution: ["host"],
    display: "runtime",
  }),
  filePatch: Object.freeze({
    capability: "file.patch",
    accepted: ["workspace", "host"],
    execution: ["host"],
    display: "runtime",
  }),
  fileSearch: Object.freeze({
    capability: "file.search",
    accepted: ["workspace", "host"],
    execution: ["host"],
    display: "runtime",
  }),
  documentInput: Object.freeze({
    capability: "document.input",
    accepted: ["workspace", "attachment", "host"],
    execution: ["host"],
    display: "attachment",
  }),
  multimodalInput: Object.freeze({
    capability: "multimodal.input",
    accepted: ["workspace", "attachment", "host"],
    execution: ["host", "service-local"],
    display: "attachment",
  }),
  scriptInput: Object.freeze({
    capability: "script.input",
    accepted: ["workspace", "attachment"],
    execution: ["host", "sandbox"],
    display: "runtime",
  }),
  nativeInput: Object.freeze({
    capability: "native.input",
    accepted: ["workspace", "attachment", "host"],
    execution: ["task-local"],
    display: "attachment",
  }),
});

export function resolvePathRef({ input = "", workspaceRoot = "", owner = "" } = {}) {
  if (input && typeof input === "object" && !Array.isArray(input)) {
    const view = String(input.view || "").trim();
    if (!Object.values(PATH_REF_VIEWS).includes(view))
      throw new Error(`invalid logical path view: ${view || "missing"}`);
    if (view === PATH_REF_VIEWS.ATTACHMENT) {
      if (!input.identity || typeof input.identity !== "object" || Array.isArray(input.identity))
        throw new Error("attachment path identity required");
      return Object.freeze({ view, identity: Object.freeze({ ...input.identity }) });
    }
    const logicalPath = String(input.path || "").trim();
    if (!logicalPath) throw new Error(`${view} path required`);
    return Object.freeze({
      view,
      path: normalizePathForPlatform(logicalPath),
      ...(input.owner ? { owner: String(input.owner) } : {}),
    });
  }
  const value = normalizePathForPlatform(input);
  const normalizedRoot = workspaceRoot ? filePath.resolve(workspaceRoot) : "";
  if (isAbsolutePathAnyPlatform(value)) {
    if (normalizedRoot) {
      const relative = filePath.relative(normalizedRoot, filePath.resolve(value));
      if (
        relative !== ".." &&
        !relative.startsWith(`..${filePath.sep}`) &&
        !filePath.isAbsolute(relative)
      ) {
        return Object.freeze({
          view: "workspace",
          path: normalizeSlashPath(relative) || ".",
          ...(owner ? { owner: String(owner) } : {}),
        });
      }
    }
    return Object.freeze({ view: "host", path: value });
  }
  return Object.freeze({
    view: "workspace",
    path: value || ".",
    ...(owner ? { owner: String(owner) } : {}),
  });
}

export function isPathWithinRoot(root, candidate) {
  const relative = filePath.relative(filePath.resolve(root), filePath.resolve(candidate));
  return (
    relative === "" ||
    (relative !== ".." &&
      !relative.startsWith(`..${filePath.sep}`) &&
      !filePath.isAbsolute(relative))
  );
}

export function resolvePathPolicy(globalConfig = {}, { platform = process.platform } = {}) {
  const configured =
    globalConfig?.security?.pathPolicy || globalConfig?.security?.path_policy || {};
  const configuredRoles = configured.roles || {};
  const configuredSuperAdmin = configuredRoles.superAdmin || configuredRoles.super_admin || {};
  const configuredCapabilities = Object.fromEntries(
    Object.entries(configured.capabilities || {}).map(([key, value]) => [
      key,
      canonicalRule(value),
    ]),
  );
  const configuredRegularUser = configuredRoles.regularUser || configuredRoles.regular_user || {};
  const executionPlatform = normalizePathPlatform(platform);
  const platformDefaults = mergePolicy(BUILTIN_PATH_POLICY, {
    roles: {
      superAdmin: {
        host: {
          deniedRoots: PLATFORM_PROTECTED_ROOTS[executionPlatform] || [],
        },
      },
    },
  });
  const override = {
    ...configured,
    roles: {
      ...configuredRoles,
      regularUser: configuredRegularUser,
      superAdmin: {
        ...configuredSuperAdmin,
        ...(configuredSuperAdmin.host
          ? { host: canonicalHostRule(configuredSuperAdmin.host) }
          : {}),
      },
    },
    capabilities: configuredCapabilities,
    resolution: canonicalResolution(configured.resolution || {}),
    display: canonicalDisplay(configured.display || {}),
  };
  delete override.roles.regular_user;
  delete override.roles.super_admin;
  return deepFreeze(mergePolicy(platformDefaults, override));
}

export function authorizePathRef({
  pathRef,
  principal = {},
  capability = "",
  pathPolicy = {},
  executionPath = "",
  workspaceRoot = "",
  executionRoots = [],
} = {}) {
  const effectivePolicy =
    isPlainObject(pathPolicy) && Object.keys(pathPolicy).length
      ? mergePolicy(BUILTIN_PATH_POLICY, pathPolicy)
      : BUILTIN_PATH_POLICY;
  const rule =
    effectivePolicy?.capabilities?.[capability] || BUILTIN_PATH_POLICY.capabilities[capability];
  if (!rule) throw new Error(`unknown path capability: ${capability}`);
  if (!rule.acceptedViews?.includes(pathRef?.view))
    return Object.freeze({ allowed: false, code: "path_view_not_accepted", pathRef, capability });
  const isSuperAdmin = principal?.isSuperUser === true || principal?.role === "super_admin";
  if (pathRef.view === "workspace") {
    const owner = String(pathRef.owner || principal?.userId || "").trim();
    const principalId = String(principal?.userId || "").trim();
    const defaultWorkspaceRule = isSuperAdmin
      ? BUILTIN_PATH_POLICY.roles.superAdmin.workspace
      : BUILTIN_PATH_POLICY.roles.regularUser.workspace;
    const workspaceRule = isSuperAdmin
      ? effectivePolicy?.roles?.superAdmin?.workspace || defaultWorkspaceRule
      : effectivePolicy?.roles?.regularUser?.workspace || defaultWorkspaceRule;
    const access =
      owner && principalId && owner !== principalId ? workspaceRule?.others : workspaceRule?.own;
    if (access === "deny")
      return Object.freeze({
        allowed: false,
        code: "workspace_owner_not_authorized",
        pathRef,
        capability,
      });
  }
  if (pathRef.view === "host") {
    if (
      rule.hostRequiresRole === "deny" ||
      (rule.hostRequiresRole === "super_admin" && !isSuperAdmin)
    )
      return Object.freeze({
        allowed: false,
        code: "host_path_not_authorized",
        pathRef,
        capability,
      });
    const hostRule =
      effectivePolicy?.roles?.superAdmin?.host || BUILTIN_PATH_POLICY.roles.superAdmin.host;
    if (hostRule.access !== "allow")
      return Object.freeze({
        allowed: false,
        code: "host_path_not_authorized",
        pathRef,
        capability,
      });
    const candidate = executionPath || pathRef.path;
    const denied = (hostRule.deniedRoots || []).some((root) =>
      isPathWithinRoot(root, candidate),
    );
    const allowed = (hostRule.allowedRoots || []).some(
      (root) => root === "<host-filesystem>" || isPathWithinRoot(root, candidate),
    );
    if (denied || !allowed)
      return Object.freeze({
        allowed: false,
        code: denied ? "host_path_denied" : "host_path_out_of_scope",
        pathRef,
        capability,
      });
  }
  if (
    pathRef.view === "workspace" &&
    executionPath &&
    ![workspaceRoot, ...executionRoots]
      .filter(Boolean)
      .some((root) => isPathWithinRoot(root, executionPath))
  )
    return Object.freeze({
      allowed: false,
      code: "workspace_path_out_of_scope",
      pathRef,
      capability,
    });
  return Object.freeze({
    allowed: true,
    code: "allowed",
    pathRef,
    capability,
    policy: pathRef.view === "host" ? "super_admin_host_access" : "workspace_access",
  });
}

export function assertToolPathContract(contract = {}) {
  if (
    !contract.capability ||
    !Array.isArray(contract.accepted) ||
    !Array.isArray(contract.execution) ||
    !contract.display
  )
    throw new Error("invalid tool path contract");
  if (contract.accepted.includes("sandbox"))
    throw new Error("sandbox cannot be a logical path view");
  if (
    contract.execution.includes("sandbox") &&
    contract.capability !== PATH_CAPABILITIES.SCRIPT_INPUT
  )
    throw new Error("sandbox execution is restricted to script.input");
  return Object.freeze({
    ...contract,
    accepted: Object.freeze([...contract.accepted]),
    execution: Object.freeze([...contract.execution]),
  });
}
