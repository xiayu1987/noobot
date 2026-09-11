/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

export const CALL_SERVICE_MANUAL = {
  call_service: {
    summary: "调用配置中已启用的外部服务端点。",
    usage: ["call_service({ serviceName, endpointName, params })"],
    params: {
      serviceName: "服务名，必须是配置里已声明且启用的服务。",
      endpointName: "端点名，省略时按服务配置的默认端点解析。",
      params: "端点入参对象，字段由该服务端点自身契约决定。",
    },
    notes: [
      "服务与端点均来自配置，不能凭猜测调用未配置的服务。",
      "服务不存在或未启用会明确报错，据此判断可用性而不是重试。",
    ],
    pitfalls: ["不要把凭证写进 params，认证信息由服务配置侧统一持有。"],
  },
};
