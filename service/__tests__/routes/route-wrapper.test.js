/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import test from "node:test";
import assert from "node:assert/strict";
import express from "express";
import {
  classifyRequestedPathError,
  createBadRequestError,
  createJsonRouteWrapper,
  decodeRequestInput,
  withJsonError,
} from "../../routes/route-wrapper.js";
import { HTTP_STATUS } from "#agent/constants";

async function withTestServer(app, run) {
  const server = await new Promise((resolve) => {
    const started = app.listen(0, "127.0.0.1", () => resolve(started));
  });
  const { port } = server.address();
  const baseUrl = `http://127.0.0.1:${port}`;
  try {
    await run(baseUrl);
  } finally {
    await new Promise((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
  }
}

test("withJsonError: 未标注状态码的异常默认 500，保留显式错误消息", async () => {
  const app = express();
  app.get(
    "/boom",
    withJsonError(async () => {
      throw new Error("boom");
    }),
  );
  await withTestServer(app, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/boom`);
    const payload = await response.json();
    assert.equal(response.status, HTTP_STATUS.INTERNAL_SERVER_ERROR);
    assert.equal(payload.ok, false);
    assert.equal(payload.error, "boom");
  });
});

test("withJsonError: 透传 createBadRequestError 的 400 与 errorCode", async () => {
  const app = express();
  app.get(
    "/bad",
    withJsonError(async () => {
      throw createBadRequestError("path is required", { code: "missing_path" });
    }),
  );
  await withTestServer(app, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/bad`);
    const payload = await response.json();
    assert.equal(response.status, HTTP_STATUS.BAD_REQUEST);
    assert.equal(payload.error, "path is required");
    assert.equal(payload.errorCode, "missing_path");
  });
});

test("decodeRequestInput: 未分类异常归为 400，已有状态码保持不变", () => {
  assert.equal(
    decodeRequestInput(() => 1),
    1,
  );
  assert.throws(
    () =>
      decodeRequestInput(() => {
        throw new TypeError("bad input");
      }),
    (error) => error.statusCode === HTTP_STATUS.BAD_REQUEST,
  );
  assert.throws(
    () =>
      decodeRequestInput(() => {
        const error = new Error("not found");
        error.statusCode = HTTP_STATUS.NOT_FOUND;
        throw error;
      }),
    (error) => error.statusCode === HTTP_STATUS.NOT_FOUND,
  );
});

test("classifyRequestedPathError: 仅 ENOENT/ENOTDIR 归为 400", () => {
  const missing = Object.assign(new Error("missing"), { code: "ENOENT" });
  const notDir = Object.assign(new Error("not dir"), { code: "ENOTDIR" });
  const denied = Object.assign(new Error("denied"), { code: "EACCES" });
  assert.equal(classifyRequestedPathError(missing).statusCode, HTTP_STATUS.BAD_REQUEST);
  assert.equal(classifyRequestedPathError(notDir).statusCode, HTTP_STATUS.BAD_REQUEST);
  assert.equal(classifyRequestedPathError(denied).statusCode, undefined);
});

test("withJsonError: 可使用 fallbackErrorKey + 自定义状态码", async () => {
  const app = express();
  app.get(
    "/fallback",
    withJsonError(
      async () => {
        throw { message: "" };
      },
      {
        statusCode: HTTP_STATUS.NOT_FOUND,
        fallbackErrorKey: "common.notFound",
        translateText: (key) => (key === "common.notFound" ? "Not Found" : ""),
      },
    ),
  );
  await withTestServer(app, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/fallback`);
    const payload = await response.json();
    assert.equal(response.status, HTTP_STATUS.NOT_FOUND);
    assert.equal(payload.ok, false);
    assert.equal(payload.error, "Not Found");
  });
});

test("createJsonRouteWrapper: 可复用默认 translate/fallback 配置", async () => {
  const app = express();
  const jsonRoute = createJsonRouteWrapper({
    translateText: (key) => (key === "common.notFound" ? "Not Found" : ""),
  });
  app.get(
    "/wrapper",
    jsonRoute(
      async () => {
        throw { message: "" };
      },
      { statusCode: HTTP_STATUS.NOT_FOUND, fallbackErrorKey: "common.notFound" },
    ),
  );
  await withTestServer(app, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/wrapper`);
    const payload = await response.json();
    assert.equal(response.status, HTTP_STATUS.NOT_FOUND);
    assert.equal(payload.ok, false);
    assert.equal(payload.error, "Not Found");
  });
});
