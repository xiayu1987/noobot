/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
export function resolveServices(effectiveConfig = {}) {
  const services = effectiveConfig?.services || {};
  const serviceEndpointList = [];
  for (const [serviceName, serviceConfig] of Object.entries(services)) {
    if (serviceConfig?.enabled === false) continue;
    const endpoints = serviceConfig?.endpoints || {};
    for (const [endpointName, endpointCfg] of Object.entries(endpoints)) {
      serviceEndpointList.push({
        serviceName,
        endpointName,
        description: endpointCfg?.description || "",
        url: endpointCfg?.url || "",
        handler: serviceConfig?.handler || "",
        query_string_format: endpointCfg?.query_string_format || "",
        body_format: endpointCfg?.body_format || "",
        custom_param_format: endpointCfg?.custom_param_format || "",
      });
    }
  }
  return serviceEndpointList;
}

