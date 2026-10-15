/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { addressPort, resolveRuntimeTopology } from "@noobot/runtime-topology-protocol/ports";
import { text } from "@noobot/shared/value";

export function resolveDesktopClientUrl(env = process.env) {
  const explicitUrl = text(env.NOOBOT_CLIENT_URL);
  if (explicitUrl) return explicitUrl;
  const topology = resolveRuntimeTopology(env);
  return `http://${topology.loopbackHost}:${addressPort(topology.clientAddr)}`;
}
