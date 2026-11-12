/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
export default async function performanceServiceHandler({ runtime, endpointCfg, body }) {
  const response = await runtime.sharedTools.fetch(endpointCfg.url);
  if (!response.ok) throw new Error(`Mock service failed: ${response.status}`);
  return { ok: true, output: { upstream: await response.text(), echo: body } };
}
