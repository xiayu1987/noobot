/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import assert from "node:assert/strict";
import http from "node:http";
import { after, before, test } from "node:test";
import { createOpenVSCodeProxy } from "../services/openvscode/proxy.js";

const TOKEN = "secret-token";
const BASE_PATH = "ws-1";
const upstreamRequests = [];
let upstream;
let front;
let frontBase = "";
let touched = 0;

function listen(server) {
  return new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
}

before(async () => {
  upstream = http.createServer((req, res) => {
    upstreamRequests.push({ url: req.url, headers: req.headers });
    res.writeHead(200, { "content-type": "text/plain" });
    res.end("upstream-ok");
  });
  await listen(upstream);
  const instance = {
    basePath: BASE_PATH,
    connectionToken: TOKEN,
    host: "127.0.0.1",
    port: upstream.address().port,
  };
  const proxy = createOpenVSCodeProxy({
    resolveInstanceFromUrl: async (url) => (url.startsWith(`/ide/${BASE_PATH}`) ? instance : null),
    touchInstance: () => {
      touched += 1;
    },
  });
  front = http.createServer((req, res) => {
    req.originalUrl = req.url;
    res.status = (code) => {
      res.statusCode = code;
      return res;
    };
    res.json = (body) => {
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify(body));
    };
    proxy.proxyHttp(req, res);
  });
  await listen(front);
  frontBase = `http://127.0.0.1:${front.address().port}`;
});

after(async () => {
  await new Promise((resolve) => front.close(resolve));
  await new Promise((resolve) => upstream.close(resolve));
});

const request = (path, headers = {}) =>
  fetch(`${frontBase}${path}`, { headers, redirect: "manual" });

function lastUpstream() {
  return upstreamRequests.at(-1);
}

test("query token GET redirects without token and sets the noobot cookie", async () => {
  const response = await request(`/ide/${BASE_PATH}/index.html?tkn=${TOKEN}&a=1`);
  assert.equal(response.status, 302);
  assert.equal(response.headers.get("location"), `/ide/${BASE_PATH}/index.html?a=1`);
  assert.equal(
    response.headers.get("set-cookie"),
    `noobot_ide_token=${BASE_PATH}:${TOKEN}; Path=/ide/${BASE_PATH}; HttpOnly; SameSite=Lax`,
  );
});

test("header, noobot cookie and openvscode cookie tokens are proxied upstream", async () => {
  const before = upstreamRequests.length;
  const viaHeader = await request(`/ide/${BASE_PATH}/a?x=1`, { "x-ide-token": TOKEN });
  assert.equal(await viaHeader.text(), "upstream-ok");
  assert.equal(lastUpstream().url, `/ide/${BASE_PATH}/a?x=1&tkn=${TOKEN}`);
  assert.equal(lastUpstream().headers["x-ide-token"], undefined);

  await (
    await request(`/ide/${BASE_PATH}/b`, { cookie: `noobot_ide_token=${BASE_PATH}:${TOKEN}` })
  ).text();
  assert.equal(lastUpstream().url, `/ide/${BASE_PATH}/b?tkn=${TOKEN}`);

  await (await request(`/ide/${BASE_PATH}/c`, { cookie: `vscode-tkn=${TOKEN}` })).text();
  assert.equal(lastUpstream().url, `/ide/${BASE_PATH}/c`);
  assert.equal(upstreamRequests.length, before + 3);
  assert.ok(touched >= 3);
});

test("missing or wrong tokens are rejected and unknown instances return 404", async () => {
  const before = upstreamRequests.length;
  assert.equal((await request(`/ide/${BASE_PATH}/a`)).status, 403);
  assert.equal((await request(`/ide/${BASE_PATH}/a?tkn=wrong`)).status, 403);
  assert.equal((await request(`/ide/${BASE_PATH}/a`, { "x-ide-token": "wrong" })).status, 403);
  assert.equal(
    (await request(`/ide/${BASE_PATH}/a`, { cookie: `noobot_ide_token=${TOKEN}` })).status,
    403,
  );
  assert.equal((await request(`/ide/other/a?tkn=${TOKEN}`)).status, 404);
  assert.equal(upstreamRequests.length, before);
});

test("canHandleRequest only accepts the ide path prefix", () => {
  const { canHandleRequest } = createOpenVSCodeProxy({});
  assert.equal(canHandleRequest("/ide/ws-1/x"), true);
  assert.equal(canHandleRequest("/ide"), false);
  assert.equal(canHandleRequest("/api/ide/x"), false);
  assert.equal(canHandleRequest(""), false);
});
