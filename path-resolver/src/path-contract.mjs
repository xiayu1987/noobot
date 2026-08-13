/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { filePath, isAbsolutePathAnyPlatform, normalizePathForPlatform, normalizeSlashPath } from "./platform.mjs";

export const PATH_REF_VIEWS = Object.freeze({ WORKSPACE: "workspace", HOST: "host", ATTACHMENT: "attachment", TASK_LOCAL: "task-local" });
export const EXECUTION_PATH_VIEWS = Object.freeze({ HOST: "host", SANDBOX: "sandbox", TASK_LOCAL: "task-local", SERVICE_LOCAL: "service-local" });
export const DISPLAY_PATH_VIEWS = Object.freeze({ LOGICAL: "logical", ATTACHMENT: "attachment", TASK_LOCAL: "task-local", NONE: "none" });

export const PATH_CAPABILITIES = Object.freeze({
  FILE_READ: "file.read", FILE_WRITE: "file.write", FILE_PATCH: "file.patch", FILE_SEARCH: "file.search",
  DOCUMENT_INPUT: "document.input", MULTIMODAL_INPUT: "multimodal.input", SCRIPT_INPUT: "script.input", NATIVE_INPUT: "native.input",
});

const DEFAULT_CAPABILITIES = Object.freeze({
  "file.read": { acceptedViews: ["workspace", "host"], hostRequiresRole: "super_admin" },
  "file.write": { acceptedViews: ["workspace", "host"], hostRequiresRole: "super_admin" },
  "file.patch": { acceptedViews: ["workspace", "host"], hostRequiresRole: "super_admin" },
  "file.search": { acceptedViews: ["workspace", "host"], hostRequiresRole: "super_admin" },
  "document.input": { acceptedViews: ["workspace", "attachment", "host"], hostRequiresRole: "super_admin" },
  "multimodal.input": { acceptedViews: ["workspace", "attachment", "host"], hostRequiresRole: "super_admin" },
  "script.input": { acceptedViews: ["workspace", "attachment"], hostRequiresRole: "deny" },
  "native.input": { acceptedViews: ["workspace", "attachment", "host"], hostRequiresRole: "super_admin" },
});
const DEFAULT_ROLES = Object.freeze({
  regularUser: Object.freeze({ workspace: Object.freeze({ own: "read_write", others: "deny" }), host: Object.freeze({ access: "deny" }) }),
  superAdmin: Object.freeze({ workspace: Object.freeze({ own: "read_write", others: "read_write" }), host: Object.freeze({ access: "allow", allowedRoots: Object.freeze(["<host-filesystem>"]), deniedRoots: Object.freeze(["/proc", "/sys", "/dev"]) }) }),
});
const DEFAULT_RESOLUTION = Object.freeze({ followSymbolicLinks: false, requireRealPathForExistingTargets: true, validateWriteParentRealPath: true, rejectAmbiguousVirtualPaths: true, caseSensitivity: "platform" });

function canonicalRule(value = {}) {
  const acceptedViews = value.acceptedViews || value.accepted_views;
  const hostRequiresRole = value.hostRequiresRole || value.host_requires_role;
  return { ...value, ...(acceptedViews ? { acceptedViews } : {}), ...(hostRequiresRole ? { hostRequiresRole } : {}) };
}

function canonicalHostRule(value = {}) {
  const allowedRoots = value.allowedRoots || value.allowed_roots;
  const deniedRoots = value.deniedRoots || value.denied_roots;
  return { ...value, ...(allowedRoots ? { allowedRoots } : {}), ...(deniedRoots ? { deniedRoots } : {}) };
}

function canonicalResolution(value = {}) {
  const fields = {
    followSymbolicLinks: value.followSymbolicLinks ?? value.follow_symbolic_links,
    requireRealPathForExistingTargets: value.requireRealPathForExistingTargets ?? value.require_real_path_for_existing_targets,
    validateWriteParentRealPath: value.validateWriteParentRealPath ?? value.validate_write_parent_real_path,
    rejectAmbiguousVirtualPaths: value.rejectAmbiguousVirtualPaths ?? value.reject_ambiguous_virtual_paths,
    caseSensitivity: value.caseSensitivity || value.case_sensitivity,
  };
  return { ...value, ...Object.fromEntries(Object.entries(fields).filter(([, item]) => item !== undefined)) };
}

export const TOOL_PATH_CONTRACTS = Object.freeze({
  fileRead: Object.freeze({ capability: "file.read", accepted: ["workspace", "host"], execution: ["host"], display: "logical" }),
  fileWrite: Object.freeze({ capability: "file.write", accepted: ["workspace", "host"], execution: ["host"], display: "logical" }),
  filePatch: Object.freeze({ capability: "file.patch", accepted: ["workspace", "host"], execution: ["host"], display: "logical" }),
  fileSearch: Object.freeze({ capability: "file.search", accepted: ["workspace", "host"], execution: ["host"], display: "logical" }),
  documentInput: Object.freeze({ capability: "document.input", accepted: ["workspace", "attachment", "host"], execution: ["host"], display: "attachment" }),
  multimodalInput: Object.freeze({ capability: "multimodal.input", accepted: ["workspace", "attachment", "host"], execution: ["host", "service-local"], display: "attachment" }),
  scriptInput: Object.freeze({ capability: "script.input", accepted: ["workspace", "attachment"], execution: ["host", "sandbox"], display: "logical" }),
  nativeInput: Object.freeze({ capability: "native.input", accepted: ["workspace", "attachment", "host"], execution: ["task-local"], display: "attachment" }),
});

export function resolvePathRef({ input = "", workspaceRoot = "", owner = "" } = {}) {
  if (input && typeof input === "object" && !Array.isArray(input)) {
    const view = String(input.view || "").trim();
    if (!Object.values(PATH_REF_VIEWS).includes(view)) throw new Error(`invalid logical path view: ${view || "missing"}`);
    if (view === PATH_REF_VIEWS.ATTACHMENT) {
      if (!input.identity || typeof input.identity !== "object" || Array.isArray(input.identity)) throw new Error("attachment path identity required");
      return Object.freeze({ view, identity: Object.freeze({ ...input.identity }) });
    }
    const logicalPath = String(input.path || "").trim();
    if (!logicalPath) throw new Error(`${view} path required`);
    return Object.freeze({ view, path: normalizePathForPlatform(logicalPath), ...(input.owner ? { owner: String(input.owner) } : {}) });
  }
  const value = normalizePathForPlatform(input);
  const normalizedRoot = workspaceRoot ? filePath.resolve(workspaceRoot) : "";
  if (isAbsolutePathAnyPlatform(value)) {
    if (normalizedRoot) {
      const relative = filePath.relative(normalizedRoot, filePath.resolve(value));
      if (relative !== ".." && !relative.startsWith(`..${filePath.sep}`) && !filePath.isAbsolute(relative)) {
        return Object.freeze({ view: "workspace", path: normalizeSlashPath(relative) || ".", ...(owner ? { owner: String(owner) } : {}) });
      }
    }
    return Object.freeze({ view: "host", path: value });
  }
  return Object.freeze({ view: "workspace", path: value || ".", ...(owner ? { owner: String(owner) } : {}) });
}

function within(root, candidate) {
  const relative = filePath.relative(filePath.resolve(root), filePath.resolve(candidate));
  return relative === "" || (relative !== ".." && !relative.startsWith(`..${filePath.sep}`) && !filePath.isAbsolute(relative));
}

export function resolvePathPolicy(globalConfig = {}) {
  const configured = globalConfig?.security?.pathPolicy || globalConfig?.security?.path_policy || {};
  const configuredRoles = configured.roles || {};
  const configuredSuperAdmin = configuredRoles.superAdmin || configuredRoles.super_admin || {};
  const configuredCapabilities = Object.fromEntries(Object.entries(configured.capabilities || {}).map(([key, value]) => [key, canonicalRule(value)]));
  return Object.freeze({
    roles: {
      regularUser: { ...DEFAULT_ROLES.regularUser, ...(configuredRoles.regularUser || configuredRoles.regular_user || {}) },
      superAdmin: { ...DEFAULT_ROLES.superAdmin, ...configuredSuperAdmin, host: { ...DEFAULT_ROLES.superAdmin.host, ...canonicalHostRule(configuredSuperAdmin.host || {}) } },
    },
    capabilities: { ...DEFAULT_CAPABILITIES, ...configuredCapabilities },
    resolution: { ...DEFAULT_RESOLUTION, ...canonicalResolution(configured.resolution || {}) },
    display: configured.display || {},
  });
}

export function authorizePathRef({ pathRef, principal = {}, capability = "", pathPolicy = {}, executionPath = "", workspaceRoot = "" } = {}) {
  const rule = pathPolicy?.capabilities?.[capability] || DEFAULT_CAPABILITIES[capability];
  if (!rule) throw new Error(`unknown path capability: ${capability}`);
  if (!rule.acceptedViews?.includes(pathRef?.view)) return Object.freeze({ allowed: false, code: "path_view_not_accepted", pathRef, capability });
  const isSuperAdmin = principal?.isSuperUser === true || principal?.role === "super_admin";
  if (pathRef.view === "workspace") {
    const owner = String(pathRef.owner || principal?.userId || "").trim();
    const principalId = String(principal?.userId || "").trim();
    const workspaceRule = isSuperAdmin ? pathPolicy?.roles?.superAdmin?.workspace : pathPolicy?.roles?.regularUser?.workspace;
    const access = owner && principalId && owner !== principalId ? workspaceRule?.others : workspaceRule?.own;
    if (access === "deny") return Object.freeze({ allowed: false, code: "workspace_owner_not_authorized", pathRef, capability });
  }
  if (pathRef.view === "host") {
    if (rule.hostRequiresRole === "deny" || (rule.hostRequiresRole === "super_admin" && !isSuperAdmin)) return Object.freeze({ allowed: false, code: "host_path_not_authorized", pathRef, capability });
    const hostRule = pathPolicy?.roles?.superAdmin?.host || {};
    if (hostRule.access !== "allow") return Object.freeze({ allowed: false, code: "host_path_not_authorized", pathRef, capability });
    const candidate = executionPath || pathRef.path;
    const denied = (hostRule.deniedRoots || []).some((root) => within(root, candidate));
    const allowed = (hostRule.allowedRoots || []).some((root) => root === "<host-filesystem>" || within(root, candidate));
    if (denied || !allowed) return Object.freeze({ allowed: false, code: denied ? "host_path_denied" : "host_path_out_of_scope", pathRef, capability });
  }
  if (pathRef.view === "workspace" && executionPath && workspaceRoot && !within(workspaceRoot, executionPath) && !isSuperAdmin) return Object.freeze({ allowed: false, code: "workspace_path_out_of_scope", pathRef, capability });
  return Object.freeze({ allowed: true, code: "allowed", pathRef, capability, policy: pathRef.view === "host" ? "super_admin_host_access" : "workspace_access" });
}

export function assertToolPathContract(contract = {}) {
  if (!contract.capability || !Array.isArray(contract.accepted) || !Array.isArray(contract.execution) || !contract.display) throw new Error("invalid tool path contract");
  if (contract.accepted.includes("sandbox")) throw new Error("sandbox cannot be a logical path view");
  if (contract.execution.includes("sandbox") && contract.capability !== "script.input") throw new Error("sandbox execution is restricted to script.input");
  return Object.freeze({ ...contract, accepted: Object.freeze([...contract.accepted]), execution: Object.freeze([...contract.execution]) });
}
