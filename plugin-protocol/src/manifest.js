/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { z } from "zod";
import { HOOK_POINT_DESCRIPTORS } from "@noobot/hook-protocol";
import {
  PLUGIN_HOST_PORT,
  PLUGIN_PERMISSION,
  PLUGIN_PROTOCOL_VERSION,
  PLUGIN_PORT_PERMISSION_REQUIREMENTS,
  PLUGIN_SURFACE,
  PLUGIN_SURFACE_HOST_PORTS,
} from "./activation.js";
import { EXTENSION_POINT_DEFINITIONS } from "./frontend.js";

const strictString = z.string().trim().min(1);
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

export const pluginFrontendContributionSchema = z
  .object({
    id: strictString,
    point: frontendPointSchema,
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
    routes: z.array(pluginRouteContributionSchema).optional(),
    extensions: z.array(pluginFrontendContributionSchema).optional(),
  })
  .strict();

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
        authenticatedRoutes: z.array(strictString).default([]),
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
    const requiredPorts = new Set(manifest.requires.ports);
    const requiredPermissions = new Set(manifest.requires.permissions);
    for (const port of requiredPorts) {
      for (const permission of PLUGIN_PORT_PERMISSION_REQUIREMENTS[port] || []) {
        if (!requiredPermissions.has(permission)) {
          context.addIssue({
            code: "custom",
            path: ["requires", "permissions"],
            message: `${permission} is required by port ${port}`,
          });
        }
      }
    }
    const requiredPortByContribution = [
      [
        "hooks.register",
        Object.values(manifest.contributes).some((item) => item?.hooks?.registers?.length),
      ],
      [
        "hooks.emit",
        Object.values(manifest.contributes).some((item) => item?.hooks?.emits?.length),
      ],
      ["routes.bind", Boolean(manifest.contributes.service?.routes?.length)],
      ["frontend.contribute", Boolean(manifest.contributes.frontend?.extensions?.length)],
    ];
    for (const [port, used] of requiredPortByContribution) {
      if (used && !requiredPorts.has(port)) {
        context.addIssue({
          code: "custom",
          path: ["requires", "ports"],
          message: `${port} is required by declared contributions`,
        });
      }
    }
    for (const surface of Object.values(PLUGIN_SURFACE)) {
      const contributes = manifest.contributes[surface];
      if (contributes && !manifest.entries[surface]) {
        context.addIssue({
          code: "custom",
          path: ["entries", surface],
          message: `contributes.${surface} requires entries.${surface}`,
        });
      }
      if (manifest.entries[surface]) {
        const allowedPorts = new Set(PLUGIN_SURFACE_HOST_PORTS[surface]);
        const surfaceUsesPort = {
          [PLUGIN_HOST_PORT.HOOKS_REGISTER]: Boolean(contributes?.hooks?.registers?.length),
          [PLUGIN_HOST_PORT.HOOKS_EMIT]: Boolean(contributes?.hooks?.emits?.length),
          [PLUGIN_HOST_PORT.ROUTES_BIND]: Boolean(contributes?.routes?.length),
          [PLUGIN_HOST_PORT.FRONTEND_CONTRIBUTE]: Boolean(contributes?.extensions?.length),
        };
        for (const [port, used] of Object.entries(surfaceUsesPort)) {
          if (used && !allowedPorts.has(port)) {
            context.addIssue({
              code: "custom",
              path: ["contributes", surface],
              message: `${port} is not available on ${surface}`,
            });
          }
        }
      }
      for (const point of [
        ...(contributes?.hooks?.registers || []).map((item) => item.point),
        ...(contributes?.hooks?.emits || []),
      ]) {
        const ownerSurface = point.startsWith("service.")
          ? PLUGIN_SURFACE.SERVICE
          : PLUGIN_SURFACE.AGENT;
        if (ownerSurface !== surface) {
          context.addIssue({
            code: "custom",
            path: ["contributes", surface, "hooks"],
            message: `${point} is owned by ${ownerSurface}`,
          });
        }
      }
      if (contributes?.routes?.length && surface !== PLUGIN_SURFACE.SERVICE) {
        context.addIssue({
          code: "custom",
          path: ["contributes", surface, "routes"],
          message: "routes are service contributions",
        });
      }
      if (contributes?.extensions?.length && surface !== PLUGIN_SURFACE.FRONTEND) {
        context.addIssue({
          code: "custom",
          path: ["contributes", surface, "extensions"],
          message: "extensions are frontend contributions",
        });
      }
      const registers = contributes?.hooks?.registers || [];
      const emits = contributes?.hooks?.emits || [];
      const registrationIds = registers.map((item) => item.id);
      if (new Set(registrationIds).size !== registrationIds.length) {
        context.addIssue({
          code: "custom",
          path: ["contributes", surface, "hooks", "registers"],
          message: "hook registration ids must be unique",
        });
      }
      if (new Set(emits).size !== emits.length) {
        context.addIssue({
          code: "custom",
          path: ["contributes", surface, "hooks", "emits"],
          message: "hook emissions must be unique",
        });
      }
    }
    const routeIds = (manifest.contributes.service?.routes || []).map((item) => item.id);
    if (new Set(routeIds).size !== routeIds.length) {
      context.addIssue({
        code: "custom",
        path: ["contributes", "service", "routes"],
        message: "route ids must be unique",
      });
    }
    const extensionIds = (manifest.contributes.frontend?.extensions || []).map((item) => item.id);
    if (new Set(extensionIds).size !== extensionIds.length) {
      context.addIssue({
        code: "custom",
        path: ["contributes", "frontend", "extensions"],
        message: "frontend contribution ids must be unique",
      });
    }
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

export function requireDeclaredPluginHook(manifest = {}, surface = "", point = "", registrationId = "") {
  const hooks = contributionsForSurface(manifest, surface)?.hooks?.registers || [];
  const normalizedPoint = String(point || "").trim();
  const normalizedId = String(registrationId || "").trim();
  const declaration = hooks.find((item) => item.point === normalizedPoint && item.id === normalizedId);
  if (!declaration) {
    throw new TypeError(`plugin ${manifest?.id || "<unknown>"} did not declare hook ${normalizedPoint}#${normalizedId}`);
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
    case "extension":
      return `extension:${String(item.contributionId || "").trim()}:${String(item.point || "").trim()}`;
    default:
      throw new TypeError(`unsupported plugin contribution receipt type: ${String(item?.type || "<empty>")}`);
  }
}

function declaredContributionKeys(manifest = {}, surface = "") {
  const contributions = contributionsForSurface(manifest, surface);
  return [
    ...(contributions?.hooks?.registers || []).map(
      (item) => `hook:${item.id}:${item.point}`,
    ),
    ...(contributions?.routes || []).map((item) => `route:${item.id}`),
    ...(contributions?.extensions || []).map(
      (item) => `extension:${item.id}:${item.point}`,
    ),
  ];
}

/**
 * Verifies the exact set of runtime registrations against the Manifest.
 * The Manifest is the sole declaration source: counts, hook points, or host
 * state must never be used to infer which contribution was registered.
 */
export function validatePluginContributionReceipt(
  manifest = {},
  surface = "",
  receipt = [],
) {
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
