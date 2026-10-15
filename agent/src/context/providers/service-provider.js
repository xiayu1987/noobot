/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { text } from "@noobot/shared/value";

function normalizeStringArray(input = []) {
  return Array.isArray(input) ? input.map((item) => text(item)).filter(Boolean) : [];
}

function resolveServiceFilter(includeRefs = []) {
  const normalizedRefs = normalizeStringArray(includeRefs);
  const hasWildcard = normalizedRefs.includes("*");
  const serviceNameSet = new Set();
  const endpointRefSet = new Set();
  if (hasWildcard) {
    return { serviceNameSet, endpointRefSet, hasWildcard };
  }
  for (const refItem of normalizedRefs) {
    const [serviceName, endpointName] = String(refItem || "").split(".");
    const normalizedServiceName = text(serviceName);
    const normalizedEndpointName = text(endpointName);
    if (!normalizedServiceName) continue;
    if (normalizedEndpointName === "*") {
      serviceNameSet.add(normalizedServiceName);
      continue;
    }
    if (normalizedEndpointName) {
      endpointRefSet.add(`${normalizedServiceName}.${normalizedEndpointName}`);
      continue;
    }
    serviceNameSet.add(normalizedServiceName);
  }
  return { serviceNameSet, endpointRefSet };
}

export function resolveServices(effectiveConfig = {}, { includeRefs = [] } = {}) {
  const services = effectiveConfig?.services || {};
  const { serviceNameSet, endpointRefSet, hasWildcard } = resolveServiceFilter(includeRefs);
  if (!hasWildcard && serviceNameSet.size === 0 && endpointRefSet.size === 0) {
    return [];
  }
  const hasFilter = !hasWildcard;
  const serviceEndpointList = [];
  for (const [serviceName, serviceConfig] of Object.entries(services)) {
    if (serviceConfig?.enabled === false) continue;
    if (hasFilter && !serviceNameSet.has(serviceName)) {
      const hasMatchedEndpointInService = [...endpointRefSet].some((endpointRef) =>
        endpointRef.startsWith(`${serviceName}.`),
      );
      if (!hasMatchedEndpointInService) continue;
    }
    const endpoints = serviceConfig?.endpoints || {};
    for (const [endpointName, endpointCfg] of Object.entries(endpoints)) {
      if (
        hasFilter &&
        !serviceNameSet.has(serviceName) &&
        !endpointRefSet.has(`${serviceName}.${endpointName}`)
      ) {
        continue;
      }
      serviceEndpointList.push({
        serviceName,
        endpointName,
        description: text(endpointCfg?.description),
        url: text(endpointCfg?.url),
        handler: text(serviceConfig?.handler),
        query_string_format: text(endpointCfg?.query_string_format),
        body_format: text(endpointCfg?.body_format),
        custom_param_format: text(endpointCfg?.custom_param_format),
      });
    }
  }
  return serviceEndpointList;
}
