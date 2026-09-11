/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import {
  filePath,
  isAbsolutePathAnyPlatform,
  normalizePathForPlatform,
  normalizeSlashPath,
} from "./platform.js";
import { PLATFORM, normalizePlatform } from "@noobot/platform-compatibility/platform";

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
  [PLATFORM.LINUX]: ["/proc", "/sys", "/dev"],
  [PLATFORM.MACOS]: ["/dev"],
  [PLATFORM.WINDOWS]: [],
});

export const TRUST_ALL_DIRECTORIES = "*";

export const HOST_FILESYSTEM_ROOT = "<host-filesystem>";
const WORKSPACE_ACCESS_LEVELS = Object.freeze(["deny", "read_only", "read_write"]);
const HOST_ACCESS_LEVELS = Object.freeze(["deny", "allow"]);
const HOST_ROLE_REQUIREMENTS = Object.freeze(["deny", "super_admin"]);
const DISPLAY_PATH_POLICIES = Object.freeze([
  ...Object.values(DISPLAY_PATH_VIEWS),
  "identity",
  "execution",
]);
const RESOLVED_PATH_POLICIES = new WeakSet();

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
  trustedDirectories: [TRUST_ALL_DIRECTORIES],
  roles: {
    regularUser: { workspace: { own: "read_write", others: "deny" } },
    superAdmin: {
      workspace: { own: "read_write", others: "read_write" },
      host: {
        access: "allow",
        allowedRoots: [HOST_FILESYSTEM_ROOT],
        deniedRoots: [],
      },
    },
  },
  capabilities: DEFAULT_CAPABILITIES,
  resolution: {
    followSymbolicLinks: false,
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

function assertPolicyOverrideShape(value, contract, path = "path policy") {
  if (!isPlainObject(value)) throw new TypeError(`${path} must be an object`);
  for (const [key, item] of Object.entries(value)) {
    if (!Object.hasOwn(contract, key)) throw new TypeError(`unsupported ${path} field: ${key}`);
    const contractItem = contract[key];
    const itemPath = `${path}.${key}`;
    if (isPlainObject(contractItem)) {
      assertPolicyOverrideShape(item, contractItem, itemPath);
    } else if (Array.isArray(contractItem)) {
      if (!Array.isArray(item)) throw new TypeError(`${itemPath} must be an array`);
    } else if (typeof item !== typeof contractItem) {
      throw new TypeError(`${itemPath} must be a ${typeof contractItem}`);
    }
  }
}

function assertEnum(value, accepted, path) {
  if (!accepted.includes(value)) {
    throw new TypeError(`${path} must be one of: ${accepted.join(", ")}`);
  }
}

function assertStringArray(value, path, validateItem = null) {
  if (!Array.isArray(value)) throw new TypeError(`${path} must be an array`);
  for (const item of value) {
    if (typeof item !== "string" || !item.trim()) {
      throw new TypeError(`${path} entries must be non-empty strings`);
    }
    if (typeof validateItem === "function") validateItem(item.trim());
  }
}

function assertAbsoluteRoot(root, path) {
  if (!isAbsolutePathAnyPlatform(root)) throw new TypeError(`${path} must be absolute: ${root}`);
}

function assertResolvedPathPolicy(policy) {
  for (const role of ["regularUser", "superAdmin"]) {
    const workspace = policy.roles[role].workspace;
    assertEnum(workspace.own, WORKSPACE_ACCESS_LEVELS, `path policy.roles.${role}.workspace.own`);
    assertEnum(
      workspace.others,
      WORKSPACE_ACCESS_LEVELS,
      `path policy.roles.${role}.workspace.others`,
    );
  }
  assertEnum(
    policy.roles.superAdmin.host.access,
    HOST_ACCESS_LEVELS,
    "path policy.roles.superAdmin.host.access",
  );
  assertStringArray(
    policy.roles.superAdmin.host.allowedRoots,
    "path policy.roles.superAdmin.host.allowedRoots",
    (root) => {
      if (root !== HOST_FILESYSTEM_ROOT) assertAbsoluteRoot(root, "allowed host root");
    },
  );
  assertStringArray(
    policy.roles.superAdmin.host.deniedRoots,
    "path policy.roles.superAdmin.host.deniedRoots",
    (root) => assertAbsoluteRoot(root, "denied host root"),
  );
  for (const [capability, rule] of Object.entries(policy.capabilities)) {
    assertStringArray(
      rule.acceptedViews,
      `path policy.capabilities.${capability}.acceptedViews`,
      (view) => assertEnum(view, Object.values(PATH_REF_VIEWS), `path policy capability view`),
    );
    assertEnum(
      rule.hostRequiresRole,
      HOST_ROLE_REQUIREMENTS,
      `path policy.capabilities.${capability}.hostRequiresRole`,
    );
  }
  if (typeof policy.resolution.followSymbolicLinks !== "boolean") {
    throw new TypeError("path policy.resolution.followSymbolicLinks must be a boolean");
  }
  for (const [field, value] of Object.entries(policy.display)) {
    assertEnum(value, DISPLAY_PATH_POLICIES, `path policy.display.${field}`);
  }
}

function requireResolvedPathPolicy(pathPolicy) {
  const policy = pathPolicy === undefined ? resolvePathPolicy() : pathPolicy;
  if (!RESOLVED_PATH_POLICIES.has(policy)) {
    throw new TypeError("path policy must be created by resolvePathPolicy");
  }
  return policy;
}

export function resolvePathPolicy({
  policyOverride = {},
  trustedDirectories = undefined,
  platform = process.platform,
} = {}) {
  if (!isPlainObject(policyOverride)) throw new TypeError("path policy override must be an object");
  if (Object.hasOwn(policyOverride, "trustedDirectories")) {
    throw new TypeError("trusted directories must use the trustedDirectories contract field");
  }
  assertPolicyOverrideShape(policyOverride, BUILTIN_PATH_POLICY);
  const executionPlatform = normalizePlatform(platform);
  if (!Object.hasOwn(PLATFORM_PROTECTED_ROOTS, executionPlatform)) {
    throw new TypeError(`unsupported path policy platform: ${String(platform || "<empty>")}`);
  }
  const platformProtectedRoots = PLATFORM_PROTECTED_ROOTS[executionPlatform];
  const platformDefaults = mergePolicy(BUILTIN_PATH_POLICY, {
    roles: {
      superAdmin: {
        host: {
          deniedRoots: platformProtectedRoots,
        },
      },
    },
  });
  const merged = mergePolicy(platformDefaults, policyOverride);
  merged.trustedDirectories = [...resolveTrustedDirectories(trustedDirectories)];
  merged.roles.superAdmin.host.deniedRoots = Array.from(
    new Set([...platformProtectedRoots, ...merged.roles.superAdmin.host.deniedRoots]),
  );
  assertResolvedPathPolicy(merged);
  const resolved = deepFreeze(merged);
  RESOLVED_PATH_POLICIES.add(resolved);
  return resolved;
}

export function resolveTrustedDirectories(configured = undefined) {
  if (configured === undefined) return BUILTIN_PATH_POLICY.trustedDirectories;
  if (!Array.isArray(configured)) throw new TypeError("trusted directories must be an array");
  const normalized = configured.map((item) => {
    if (typeof item !== "string" || !item.trim()) {
      throw new TypeError("trusted directory entries must be non-empty strings");
    }
    const directory = item.trim();
    if (directory !== TRUST_ALL_DIRECTORIES && !isAbsolutePathAnyPlatform(directory)) {
      throw new TypeError(`trusted directory must be absolute: ${directory}`);
    }
    return directory;
  });
  const unique = Array.from(new Set(normalized));
  if (unique.includes(TRUST_ALL_DIRECTORIES) && unique.length !== 1) {
    throw new TypeError('trusted directory wildcard "*" cannot be combined with concrete paths');
  }
  return Object.freeze(unique);
}

export function isTrustedDirectoryPath(candidatePath = "", pathPolicy = undefined) {
  if (typeof candidatePath !== "string") {
    throw new TypeError("trusted-directory candidate must be a string");
  }
  const candidate = candidatePath.trim();
  if (!candidate || !isAbsolutePathAnyPlatform(candidate)) {
    throw new TypeError("trusted-directory candidate must be an absolute path");
  }
  const policy = requireResolvedPathPolicy(pathPolicy);
  const resolvedCandidate = filePath.resolve(candidate);
  if (
    policy.roles.superAdmin.host.deniedRoots.some((root) =>
      isPathWithinRoot(root, resolvedCandidate),
    )
  ) {
    return false;
  }
  const trustedDirectories = policy.trustedDirectories;
  if (trustedDirectories.includes(TRUST_ALL_DIRECTORIES)) return true;
  return trustedDirectories.some((root) => isPathWithinRoot(root, resolvedCandidate));
}

export function authorizePathRef({
  pathRef,
  principal = {},
  capability = "",
  pathPolicy = undefined,
  executionPath = "",
  workspaceRoot = "",
  executionRoots = [],
} = {}) {
  const effectivePolicy = requireResolvedPathPolicy(pathPolicy);
  const rule = effectivePolicy.capabilities[capability];
  if (!rule) throw new Error(`unknown path capability: ${capability}`);
  if (!rule.acceptedViews?.includes(pathRef?.view))
    return Object.freeze({ allowed: false, code: "path_view_not_accepted", pathRef, capability });
  const isSuperAdmin = principal?.role === "super_admin";
  if (pathRef.view === "workspace") {
    const owner = String(pathRef.owner || principal?.userId || "").trim();
    const principalId = String(principal?.userId || "").trim();
    const workspaceRule = isSuperAdmin
      ? effectivePolicy.roles.superAdmin.workspace
      : effectivePolicy.roles.regularUser.workspace;
    const access =
      owner && principalId && owner !== principalId ? workspaceRule.others : workspaceRule.own;
    const writeCapability = [PATH_CAPABILITIES.FILE_WRITE, PATH_CAPABILITIES.FILE_PATCH].includes(
      capability,
    );
    if (access === "deny" || (access === "read_only" && writeCapability))
      return Object.freeze({
        allowed: false,
        code: "workspace_owner_not_authorized",
        pathRef,
        capability,
      });
  }
  if (pathRef.view === "host") {
    if (!executionPath || !isAbsolutePathAnyPlatform(executionPath)) {
      throw new TypeError("host path authorization requires an absolute execution path");
    }
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
    const hostRule = effectivePolicy.roles.superAdmin.host;
    if (hostRule.access !== "allow")
      return Object.freeze({
        allowed: false,
        code: "host_path_not_authorized",
        pathRef,
        capability,
      });
    const candidate = executionPath;
    const denied = hostRule.deniedRoots.some((root) => isPathWithinRoot(root, candidate));
    const allowed = hostRule.allowedRoots.some(
      (root) => root === HOST_FILESYSTEM_ROOT || isPathWithinRoot(root, candidate),
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
