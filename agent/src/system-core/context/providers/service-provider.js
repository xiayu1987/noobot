/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
function normalizeStringArray(input = []) {
  return Array.isArray(input)
    ? input
        .map((item) => String(item || "").trim())
        .filter(Boolean)
    : [];
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
    const normalizedServiceName = String(serviceName || "").trim();
    const normalizedEndpointName = String(endpointName || "").trim();
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
  // 语义约定：
  // - ["*"] => 全量可用 service
  // - [] / 未配置 => 不传任何 service
  // - ["svc"] / ["svc.ep"] => 仅传指定 service 或 endpoint
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
        description: String(endpointCfg?.description || "").trim(),
        url: String(endpointCfg?.url || "").trim(),
        handler: String(serviceConfig?.handler || "").trim(),
        query_string_format: String(endpointCfg?.query_string_format || "").trim(),
        body_format: String(endpointCfg?.body_format || "").trim(),
        custom_param_format: String(endpointCfg?.custom_param_format || "").trim(),
      });
    }
  }
  return serviceEndpointList;
}
