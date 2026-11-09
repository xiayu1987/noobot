/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import test from "node:test";
import assert from "node:assert/strict";
import { parseRequestPathname, parseRequestQuery } from "../../src/shared/utils.js";

test("request URL readers reject malformed and missing URLs instead of projecting an empty path", () => {
  for (const request of [undefined, null, {}, { url: "" }, { url: 1 }, { url: "http://[" }]) {
    assert.throws(() => parseRequestPathname(request), TypeError);
    assert.throws(() => parseRequestQuery(request), TypeError);
  }
});

test("request URL readers preserve valid routing and optional query semantics", () => {
  const request = Object.freeze({
    url: "/chat?apikey=ignored&locale=en-US",
    headers: { "sec-websocket-protocol": "noobot-auth.key" },
  });
  assert.equal(parseRequestPathname(request), "/chat");
  assert.deepEqual(parseRequestQuery(request), {
    pathname: "/chat",
    apiKey: "key",
    locale: "en-US",
  });
  assert.deepEqual(parseRequestQuery({ url: "/" }), {
    pathname: "/",
    apiKey: "",
    locale: "",
  });
});
