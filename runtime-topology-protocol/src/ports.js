/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

/**
 * The single source of truth for Noobot runtime port topology.
 *
 * Every consumer (launcher scripts, PM2 ecosystem, service bootstrap,
 * agent-proxy, Electron shell, Vite dev server) derives its defaults from this
 * frozen constant. Port literals must not be duplicated anywhere else.
 */
export const RUNTIME_PORT_TOPOLOGY = Object.freeze({
  loopbackHost: "127.0.0.1",
  clientAddr: ":10060",
  servicePort: 10061,
  agentProxyPort: 10062,
});

const SHELL_EXPORT_KEYS = Object.freeze([
  "CADDY_ADDR",
  "AGENT_PROXY_UPSTREAM",
  "PORT",
  "AGENT_PROXY_PORT",
  "AGENT_PROXY_HOST",
  "AGENT_PROXY_UPSTREAM_WS_URL",
  "AGENT_PROXY_UPSTREAM_HTTP_BASE",
]);

function pick(env, key, fallback) {
  const value = env[key];
  return value === undefined || value === null || value === "" ? String(fallback) : String(value);
}

/**
 * Extract the trailing port from an address or URL form such as
 * ":<port>", "<host>:<port>" or "ws://<host>:<port>/chat/ws".
 */
export function addressPort(address) {
  let value = String(address ?? "");
  const schemeIndex = value.indexOf("://");
  if (schemeIndex >= 0) value = value.slice(schemeIndex + 3);
  const slashIndex = value.indexOf("/");
  if (slashIndex >= 0) value = value.slice(0, slashIndex);
  const colonIndex = value.lastIndexOf(":");
  if (colonIndex >= 0) value = value.slice(colonIndex + 1);
  return /^[0-9]+$/.test(value) ? value : null;
}

/**
 * Pure reduction of an environment bag onto the port topology defaults.
 * Environment values always win; nothing is read from disk or process state.
 */
export function resolveRuntimeTopology(env = {}) {
  const loopbackHost = pick(env, "AGENT_PROXY_HOST", RUNTIME_PORT_TOPOLOGY.loopbackHost);
  const clientAddr = pick(env, "CADDY_ADDR", RUNTIME_PORT_TOPOLOGY.clientAddr);
  const servicePort = pick(env, "PORT", RUNTIME_PORT_TOPOLOGY.servicePort);
  const agentProxyPort = pick(env, "AGENT_PROXY_PORT", RUNTIME_PORT_TOPOLOGY.agentProxyPort);
  return {
    loopbackHost,
    clientAddr,
    servicePort,
    agentProxyPort,
    agentProxyUpstream: pick(env, "AGENT_PROXY_UPSTREAM", `${loopbackHost}:${agentProxyPort}`),
    agentProxyUpstreamWsUrl: pick(
      env,
      "AGENT_PROXY_UPSTREAM_WS_URL",
      `ws://${loopbackHost}:${servicePort}/chat/ws`,
    ),
    agentProxyUpstreamHttpBase: pick(
      env,
      "AGENT_PROXY_UPSTREAM_HTTP_BASE",
      `http://${loopbackHost}:${servicePort}`,
    ),
  };
}

/** Shape the topology into the environment bag consumed by PM2 apps. */
export function toProcessEnv(env = {}) {
  const topology = resolveRuntimeTopology(env);
  return {
    CADDY_ADDR: topology.clientAddr,
    AGENT_PROXY_UPSTREAM: topology.agentProxyUpstream,
    PORT: topology.servicePort,
    AGENT_PROXY_PORT: topology.agentProxyPort,
    AGENT_PROXY_HOST: topology.loopbackHost,
    AGENT_PROXY_UPSTREAM_WS_URL: topology.agentProxyUpstreamWsUrl,
    AGENT_PROXY_UPSTREAM_HTTP_BASE: topology.agentProxyUpstreamHttpBase,
  };
}

/** Listening ports every start/stop script must probe, in a stable order. */
export function listeningPorts(env = {}) {
  const topology = resolveRuntimeTopology(env);
  return [topology.clientAddr, topology.servicePort, topology.agentProxyPort]
    .map((value) => addressPort(value))
    .filter((value) => value !== null);
}

/** Render `export KEY=VALUE` lines for shell consumers to eval. */
export function shellExports(env = {}) {
  const values = toProcessEnv(env);
  const topology = resolveRuntimeTopology(env);
  const lines = SHELL_EXPORT_KEYS.map((key) => `export ${key}=${JSON.stringify(values[key])}`);
  lines.push(
    `export NOOBOT_TOPOLOGY_CLIENT_ADDR=${JSON.stringify(`0.0.0.0:${addressPort(topology.clientAddr)}`)}`,
  );
  lines.push(
    `export NOOBOT_TOPOLOGY_API_UPSTREAM=${JSON.stringify(`${topology.loopbackHost}:${topology.servicePort}`)}`,
  );
  lines.push(`export NOOBOT_RUNTIME_LISTEN_PORTS=${JSON.stringify(listeningPorts(env).join(" "))}`);
  return `${lines.join("\n")}\n`;
}

export { SHELL_EXPORT_KEYS };
