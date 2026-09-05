/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import assert from "node:assert/strict";
import test from "node:test";
import {
  RUNTIME_PORT_TOPOLOGY,
  addressPort,
  listeningPorts,
  resolveRuntimeTopology,
  shellExports,
  toProcessEnv,
} from "../src/ports.js";

test("topology contract is frozen and complete", () => {
  assert.ok(Object.isFrozen(RUNTIME_PORT_TOPOLOGY));
  for (const key of ["loopbackHost", "clientAddr", "servicePort", "agentProxyPort"]) {
    assert.ok(RUNTIME_PORT_TOPOLOGY[key], `missing ${key}`);
  }
});

test("resolveRuntimeTopology derives upstreams from contract defaults", () => {
  const topology = resolveRuntimeTopology({});
  assert.equal(topology.clientAddr, RUNTIME_PORT_TOPOLOGY.clientAddr);
  assert.equal(topology.servicePort, String(RUNTIME_PORT_TOPOLOGY.servicePort));
  assert.equal(
    topology.agentProxyUpstream,
    `${RUNTIME_PORT_TOPOLOGY.loopbackHost}:${RUNTIME_PORT_TOPOLOGY.agentProxyPort}`,
  );
  assert.equal(
    topology.agentProxyUpstreamWsUrl,
    `ws://${RUNTIME_PORT_TOPOLOGY.loopbackHost}:${RUNTIME_PORT_TOPOLOGY.servicePort}/chat/ws`,
  );
});

test("environment values win over contract defaults", () => {
  const topology = resolveRuntimeTopology({ PORT: "31061", AGENT_PROXY_PORT: "31062" });
  assert.equal(topology.servicePort, "31061");
  assert.equal(topology.agentProxyUpstream, `${RUNTIME_PORT_TOPOLOGY.loopbackHost}:31062`);
  assert.match(topology.agentProxyUpstreamWsUrl, /:31061\/chat\/ws$/);
});

test("empty environment values fall back instead of blanking", () => {
  const topology = resolveRuntimeTopology({ PORT: "", CADDY_ADDR: "" });
  assert.equal(topology.servicePort, String(RUNTIME_PORT_TOPOLOGY.servicePort));
  assert.equal(topology.clientAddr, RUNTIME_PORT_TOPOLOGY.clientAddr);
});

test("resolveRuntimeTopology is pure with respect to process state", () => {
  assert.deepEqual(resolveRuntimeTopology({}), resolveRuntimeTopology({}));
});

test("addressPort extracts ports from address and url forms", () => {
  assert.equal(addressPort(":10060"), "10060");
  assert.equal(addressPort("127.0.0.1:10062"), "10062");
  assert.equal(addressPort("ws://127.0.0.1:10061/chat/ws"), "10061");
  assert.equal(addressPort("no-port-here"), null);
});

test("listeningPorts returns client, service and proxy ports in order", () => {
  assert.deepEqual(listeningPorts({}), [
    addressPort(RUNTIME_PORT_TOPOLOGY.clientAddr),
    String(RUNTIME_PORT_TOPOLOGY.servicePort),
    String(RUNTIME_PORT_TOPOLOGY.agentProxyPort),
  ]);
});

test("toProcessEnv exposes every launcher variable as a string", () => {
  const env = toProcessEnv({});
  for (const value of Object.values(env)) assert.equal(typeof value, "string");
  assert.equal(env.PORT, String(RUNTIME_PORT_TOPOLOGY.servicePort));
});

test("shellExports emits quoted export lines plus the listening port list", () => {
  const rendered = shellExports({});
  assert.match(rendered, /^export CADDY_ADDR=":10060"$/m);
  assert.match(rendered, /^export NOOBOT_RUNTIME_LISTEN_PORTS="10060 10061 10062"$/m);
});
