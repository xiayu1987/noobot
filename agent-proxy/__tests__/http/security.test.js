/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import test from "node:test";
import assert from "node:assert/strict";

import { getClientIp } from "../../src/http/security.js";

const LOOPBACK_PROXIES = ["127.0.0.1", "::1"];

function request(remoteAddress, forwardedFor) {
  return {
    socket: { remoteAddress },
    headers: forwardedFor === undefined ? {} : { "x-forwarded-for": forwardedFor },
  };
}

test("getClientIp ignores X-Forwarded-For when no proxy is trusted", () => {
  assert.equal(getClientIp(request("203.0.113.9", "127.0.0.1")), "203.0.113.9");
  assert.equal(getClientIp(request("127.0.0.1", "198.51.100.1"), []), "127.0.0.1");
});

test("getClientIp ignores X-Forwarded-For from an untrusted direct peer", () => {
  assert.equal(getClientIp(request("203.0.113.9", "10.0.0.1"), LOOPBACK_PROXIES), "203.0.113.9");
});

test("getClientIp takes the right-most untrusted hop behind a trusted proxy", () => {
  assert.equal(
    getClientIp(request("127.0.0.1", "10.0.0.1, 198.51.100.7"), LOOPBACK_PROXIES),
    "198.51.100.7",
  );
});

test("getClientIp strips every trusted proxy hop from the right", () => {
  assert.equal(
    getClientIp(request("127.0.0.1", "198.51.100.7, 192.168.1.2, ::1"), [
      ...LOOPBACK_PROXIES,
      "192.168.*",
    ]),
    "198.51.100.7",
  );
});

test("getClientIp falls back to the left-most hop when every hop is trusted", () => {
  assert.equal(getClientIp(request("127.0.0.1", "::1, 127.0.0.1"), LOOPBACK_PROXIES), "::1");
});

test("getClientIp uses the direct peer when a trusted proxy sends no header", () => {
  assert.equal(getClientIp(request("127.0.0.1"), LOOPBACK_PROXIES), "127.0.0.1");
  assert.equal(getClientIp(request("127.0.0.1", " , "), LOOPBACK_PROXIES), "127.0.0.1");
});

test("getClientIp matches IPv4-mapped IPv6 peers against IPv4 proxy rules", () => {
  assert.equal(
    getClientIp(request("::ffff:127.0.0.1", "198.51.100.7"), LOOPBACK_PROXIES),
    "198.51.100.7",
  );
});
