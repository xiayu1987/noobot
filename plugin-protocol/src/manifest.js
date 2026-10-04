/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { z } from "zod";
import {
  HOOK_POINT_DESCRIPTORS,
  HOOK_POINT_DOMAIN,
  requireHookPointDomain,
} from "@noobot/hook-protocol";
import {
  PLUGIN_HOST_PORT,
  PLUGIN_PERMISSION,
  PLUGIN_PROTOCOL_VERSION,
  PLUGIN_PORT_PERMISSION_REQUIREMENTS,
  PLUGIN_SURFACE,
  PLUGIN_SURFACE_HOST_PORTS,
} from "./activation.js";
import { EXTENSION_POINT_DEFINITIONS, FRONTEND_EXTENSION_KIND } from "./frontend.js";

const strictString = z.string().trim().min(1);
const frontendModuleSpecifierSchema = strictString.refine(
  (value) =>
    value.startsWith("./") ||
    /^(?:@[a-z0-9][a-z0-9._-]*\/[a-z0-9][a-z0-9._-]*|[a-z0-9][a-z0-9._-]*)(?:\/[a-z0-9][a-z0-9._-]*)*$/i.test(
      value,
    ),
  (value) => ({ message: `invalid frontend component module: ${value}` }),
);
const hookPointSchema = strictString.refine(
  (point) => Boolean(HOOK_POINT_DESCRIPTORS[point]),
  (point) => ({ message: `unknown hook point: ${point}` }),
);
const frontendPointSchema = strictString.refine(
  (point) => Boolean(EXTENSION_POINT_DEFINITIONS[point]),
  (point) => ({ message: `unknown frontend extension point: ${point}` }),
);
const hostPortSchema = z.enum(Object.values(PLUGIN_HOST_PORT));
const permissionSchema = z.enum(Object.values(PLUGIN_PERMISSION));
const authenticatedRouteSchema = z
  .object({
    method: z.enum(["GET", "POST", "PUT", "PATCH", "DELETE"]),
    path: strictString,
  })
  .strict();
export const pluginHookRegistrationContributionSchema = z
  .object({ id: strictString, point: hookPointSchema })
  .strict();

export const pluginRouteContributionSchema = z
  .object({
    id: strictString,
    method: z.enum(["GET", "POST", "PUT", "PATCH", "DELETE"]),
    paths: z.array(strictString).min(1),
    auth: z.enum(["connected_user", "internal"]),
  })
  .strict();

export const pluginToolContributionSchema = z
  .object({
    id: strictString,
    name: strictString,
  })
  .strict();

export const pluginFrontendContributionSchema = z
  .object({
    id: strictString,
    point: frontendPointSchema,
    component: z
      .object({
        module: frontendModuleSpecifierSchema,
        export: strictString,
      })
      .strict()
      .optional(),
  })
  .strict();

export const pluginExecutionIntentSchema = z
  .object({
    kind: strictString,
    idPrefix: strictString,
    originType: strictString,
    originIdKey: strictString,
    stage: strictString.optional(),
  })
  .strict();

function validateFrontendExtensionModules(extensions = [], context) {
  for (const [index, extension] of extensions.entries()) {
    const definition = EXTENSION_POINT_DEFINITIONS[extension.point];
    const componentPath = ["contributes", "frontend", "extensions", index, "component"];
    if (definition?.kind === FRONTEND_EXTENSION_KIND.COMPONENT && !extension.component) {
      context.addIssue({
        code: "custom",
        path: componentPath,
        message: `${extension.point} requires a declarative component module`,
      });
    }
    if (definition?.kind === FRONTEND_EXTENSION_KIND.PROVIDER && extension.component) {
      context.addIssue({
        code: "custom",
        path: componentPath,
        message: `${extension.point} does not accept a component module`,
      });
    }
  }
}

const surfaceContributionSchema = z
  .object({
    hooks: z
      .object({
        registers: z.array(pluginHookRegistrationContributionSchema).default([]),
        emits: z.array(hookPointSchema).default([]),
      })
      .strict()
      .optional(),
    executionIntent: pluginExecutionIntentSchema.optional(),
    tools: z.array(pluginToolContributionSchema).optional(),
    routes: z.array(pluginRouteContributionSchema).optional(),
    extensions: z.array(pluginFrontendContributionSchema).optional(),
  })
  .strict();

const CONTRIBUTION_ID_UNIQUENESS_RULES = Object.freeze([
  ["service", "routes", "route ids must be unique"],
  ["agent", "tools", "tool contribution ids must be unique"],
  ["frontend", "extensions", "frontend contribution ids must be unique"],
]);

function addManifestIssue(context, path, message) {
  context.addIssue({ code: "custom", path, message });
}

function validateRequiredPorts(manifest, context) {
  const requiredPermissions = new Set(manifest.requires.permissions);
  for (const port of new Set(manifest.requires.ports)) {
    const supportedByDeclaredEntry = Object.values(PLUGIN_SURFACE).some(
      (surface) => manifest.entries[surface] && PLUGIN_SURFACE_HOST_PORTS[surface].includes(port),
    );
    if (!supportedByDeclaredEntry) {
      addManifestIssue(
        context,
        ["requires", "ports"],
        `${port} is not available on any declared plugin entry`,
      );
    }
    for (const permission of PLUGIN_PORT_PERMISSION_REQUIREMENTS[port] || []) {
      if (!requiredPermissions.has(permission)) {
        addManifestIssue(
          context,
          ["requires", "permissions"],
          `${permission} is required by port ${port}`,
        );
      }
    }
  }
}

function validateContributionPorts(manifest, context) {
  const requiredPorts = new Set(manifest.requires.ports);
  const contributions = Object.values(manifest.contributes);
  const requiredPortByContribution = [
    ["hooks.register", contributions.some((item) => item?.hooks?.registers?.length)],
    ["hooks.emit", contributions.some((item) => item?.hooks?.emits?.length)],
    ["tools.register", Boolean(manifest.contributes.agent?.tools?.length)],
    ["routes.bind", Boolean(manifest.contributes.service?.routes?.length)],
    ["frontend.contribute", Boolean(manifest.contributes.frontend?.extensions?.length)],
  ];
  for (const [port, used] of requiredPortByContribution) {
    if (used && !requiredPorts.has(port)) {
      addManifestIssue(
        context,
        ["requires", "ports"],
        `${port} is required by declared contributions`,
      );
    }
  }
}

function validateSurfacePorts(surface, contributes, context) {
  const allowedPorts = new Set(PLUGIN_SURFACE_HOST_PORTS[surface]);
  const surfaceUsesPort = {
    [PLUGIN_HOST_PORT.HOOKS_REGISTER]: Boolean(contributes?.hooks?.registers?.length),
    [PLUGIN_HOST_PORT.HOOKS_EMIT]: Boolean(contributes?.hooks?.emits?.length),
    [PLUGIN_HOST_PORT.TOOLS_REGISTER]: Boolean(contributes?.tools?.length),
    [PLUGIN_HOST_PORT.ROUTES_BIND]: Boolean(contributes?.routes?.length),
    [PLUGIN_HOST_PORT.FRONTEND_CONTRIBUTE]: Boolean(contributes?.extensions?.length),
  };
  for (const [port, used] of Object.entries(surfaceUsesPort)) {
    if (used && !allowedPorts.has(port)) {
      addManifestIssue(context, ["contributes", surface], `${port} is not available on ${surface}`);
    }
  }
}

function validateSurfaceHookOwnership(surface, contributes, context) {
  for (const point of [
    ...(contributes?.hooks?.registers || []).map((item) => item.point),
    ...(contributes?.hooks?.emits || []),
  ]) {
    const ownerSurface =
      requireHookPointDomain(point) === HOOK_POINT_DOMAIN.SERVICE
        ? PLUGIN_SURFACE.SERVICE
        : PLUGIN_SURFACE.AGENT;
    if (ownerSurface !== surface) {
      addManifestIssue(
        context,
        ["contributes", surface, "hooks"],
        `${point} is owned by ${ownerSurface}`,
      );
    }
  }
}

const SURFACE_CONTRIBUTION_OWNERS = Object.freeze([
  ["routes", PLUGIN_SURFACE.SERVICE, "routes are service contributions"],
  ["tools", PLUGIN_SURFACE.AGENT, "tools are agent contributions"],
  ["extensions", PLUGIN_SURFACE.FRONTEND, "extensions are frontend contributions"],
]);

function validateSurfaceContributionKinds(surface, contributes, context) {
  for (const [key, ownerSurface, message] of SURFACE_CONTRIBUTION_OWNERS) {
    if (contributes?.[key]?.length && surface !== ownerSurface) {
      addManifestIssue(context, ["contributes", surface, key], message);
    }
  }
}

function hasDuplicates(values) {
  return new Set(values).size !== values.length;
}

function validateSurfaceHookUniqueness(surface, contributes, context) {
  const registers = contributes?.hooks?.registers || [];
  const emits = contributes?.hooks?.emits || [];
  if (hasDuplicates(registers.map((item) => item.id))) {
    addManifestIssue(
      context,
      ["contributes", surface, "hooks", "registers"],
      "hook registration ids must be unique",
    );
  }
  if (hasDuplicates(emits)) {
    addManifestIssue(
      context,
      ["contributes", surface, "hooks", "emits"],
      "hook emissions must be unique",
    );
  }
}

function validateSurfaceContributions(manifest, context) {
  for (const surface of Object.values(PLUGIN_SURFACE)) {
    const contributes = manifest.contributes[surface];
    if (contributes && !manifest.entries[surface]) {
      addManifestIssue(
        context,
        ["entries", surface],
        `contributes.${surface} requires entries.${surface}`,
      );
    }
    if (manifest.entries[surface]) validateSurfacePorts(surface, contributes, context);
    validateSurfaceHookOwnership(surface, contributes, context);
    validateSurfaceContributionKinds(surface, contributes, context);
    validateSurfaceHookUniqueness(surface, contributes, context);
  }
}

function validateContributionIdUniqueness(manifest, context) {
  for (const [surface, key, message] of CONTRIBUTION_ID_UNIQUENESS_RULES) {
    const ids = (manifest.contributes[surface]?.[key] || []).map((item) => item.id);
    if (hasDuplicates(ids)) addManifestIssue(context, ["contributes", surface, key], message);
  }
}

export const pluginManifestSchema = z
  .object({
    protocolVersion: z.literal(PLUGIN_PROTOCOL_VERSION),
    id: strictString,
    name: strictString,
    version: strictString,
    description: z.string().optional(),
    entries: z
      .object({
        agent: strictString.optional(),
        service: strictString.optional(),
        frontend: strictString.optional(),
      })
      .strict(),
    contributes: z
      .object({
        agent: surfaceContributionSchema.optional(),
        service: surfaceContributionSchema.optional(),
        frontend: surfaceContributionSchema.optional(),
      })
      .strict(),
    requires: z
      .object({
        ports: z.array(hostPortSchema).default([]),
        permissions: z.array(permissionSchema).default([]),
        authenticatedRoutes: z.array(authenticatedRouteSchema).default([]),
      })
      .strict(),
    configuration: z
      .object({
        defaults: z.record(z.string(), z.unknown()).default({}),
      })
      .strict()
      .optional(),
    enabledByDefault: z.boolean(),
  })
  .strict()
  .superRefine((manifest, context) => {
    validateRequiredPorts(manifest, context);
    validateContributionPorts(manifest, context);
    validateSurfaceContributions(manifest, context);
    validateContributionIdUniqueness(manifest, context);
    validateFrontendExtensionModules(manifest.contributes.frontend?.extensions, context);
  });

export function parsePluginManifest(input = {}) {
  return pluginManifestSchema.parse(input);
}

export function contributionsForSurface(manifest = {}, surface = "") {
  const normalized = String(surface || "").trim();
  return manifest?.contributes?.[normalized] || null;
}

export function manifestContributesToSurface(manifest = {}, surface = "") {
  return Boolean(contributionsForSurface(manifest, surface));
}

export function requireDeclaredPluginHook(
  manifest = {},
  surface = "",
  point = "",
  registrationId = "",
) {
  const hooks = contributionsForSurface(manifest, surface)?.hooks?.registers || [];
  const normalizedPoint = String(point || "").trim();
  const normalizedId = String(registrationId || "").trim();
  const declaration = hooks.find(
    (item) => item.point === normalizedPoint && item.id === normalizedId,
  );
  if (!declaration) {
    throw new TypeError(
      `plugin ${manifest?.id || "<unknown>"} did not declare hook ${normalizedPoint}#${normalizedId}`,
    );
  }
  return declaration;
}

export function requireDeclaredPluginHookEmission(manifest = {}, surface = "", point = "") {
  const hooks = contributionsForSurface(manifest, surface)?.hooks?.emits || [];
  if (!hooks.includes(String(point || "").trim())) {
    throw new TypeError(
      `plugin ${manifest?.id || "<unknown>"} did not declare hook emission ${point}`,
    );
  }
  return point;
}

export function requireDeclaredPluginRoute(manifest = {}, routeId = "") {
  const normalized = String(routeId || "").trim();
  const route = (manifest?.contributes?.service?.routes || []).find(
    (item) => item.id === normalized,
  );
  if (!route)
    throw new TypeError(
      `plugin ${manifest?.id || "<unknown>"} did not declare route ${normalized}`,
    );
  return route;
}

export function requireDeclaredPluginTool(manifest = {}, toolId = "") {
  const normalized = String(toolId || "").trim();
  const tool = (manifest?.contributes?.agent?.tools || []).find((item) => item.id === normalized);
  if (!tool)
    throw new TypeError(`plugin ${manifest?.id || "<unknown>"} did not declare tool ${normalized}`);
  return tool;
}

export function requireDeclaredFrontendContribution(
  manifest = {},
  contributionId = "",
  point = "",
) {
  const normalizedId = String(contributionId || "").trim();
  const normalizedPoint = String(point || "").trim();
  const declaration = (manifest?.contributes?.frontend?.extensions || []).find(
    (item) => item.id === normalizedId && item.point === normalizedPoint,
  );
  if (!declaration) {
    throw new TypeError(
      `plugin ${manifest?.id || "<unknown>"} did not declare frontend contribution ${normalizedPoint}#${normalizedId}`,
    );
  }
  return declaration;
}

function contributionReceiptKey(item = {}) {
  switch (item?.type) {
    case "hook":
      return `hook:${String(item.registrationId || "").trim()}:${String(item.point || "").trim()}`;
    case "route":
      return `route:${String(item.routeId || "").trim()}`;
    case "tool":
      return `tool:${String(item.toolId || "").trim()}`;
    case "extension":
      return `extension:${String(item.contributionId || "").trim()}:${String(item.point || "").trim()}`;
    default:
      throw new TypeError(
        `unsupported plugin contribution receipt type: ${String(item?.type || "<empty>")}`,
      );
  }
}

function declaredContributionKeys(manifest = {}, surface = "") {
  const contributions = contributionsForSurface(manifest, surface);
  return [
    ...(contributions?.hooks?.registers || []).map((item) => `hook:${item.id}:${item.point}`),
    ...(contributions?.routes || []).map((item) => `route:${item.id}`),
    ...(contributions?.tools || []).map((item) => `tool:${item.id}`),
    ...(contributions?.extensions || []).map((item) => `extension:${item.id}:${item.point}`),
  ];
}

export function validatePluginContributionReceipt(manifest = {}, surface = "", receipt = []) {
  const normalizedSurface = String(surface || "").trim();
  const expected = declaredContributionKeys(manifest, normalizedSurface);
  const actual = (Array.isArray(receipt) ? receipt : []).map(contributionReceiptKey);
  const actualSet = new Set(actual);
  if (actualSet.size !== actual.length) {
    throw new TypeError(
      `plugin ${manifest?.id || "<unknown>"} registered duplicate contributions on ${normalizedSurface}`,
    );
  }
  const expectedSet = new Set(expected);
  const missing = expected.filter((key) => !actualSet.has(key));
  const unexpected = actual.filter((key) => !expectedSet.has(key));
  if (missing.length || unexpected.length) {
    throw new TypeError(
      `plugin ${manifest?.id || "<unknown>"} contribution receipt mismatch on ${normalizedSurface}` +
        `${missing.length ? `; missing: ${missing.join(", ")}` : ""}` +
        `${unexpected.length ? `; unexpected: ${unexpected.join(", ")}` : ""}`,
    );
  }
  return Object.freeze([...actual]);
}
