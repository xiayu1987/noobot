/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

export const CALL_SERVICE_MANUAL = {
  call_service: {
    summary: "Call an external service endpoint that is enabled in configuration.",
    usage: ["call_service({ serviceName, endpointName, params })"],
    params: {
      serviceName: "Service name. Must be declared and enabled in configuration.",
      endpointName: "Endpoint name. Omit to resolve the service default endpoint.",
      params: "Endpoint input object; its fields come from that endpoint's own contract.",
    },
    notes: [
      "Services and endpoints both come from configuration; never call an unconfigured service on a guess.",
      "A missing or disabled service fails explicitly. Read that as availability, not as a reason to retry.",
    ],
    pitfalls: [
      "Do not put credentials in params. Authentication is held on the service configuration side.",
    ],
  },
};
