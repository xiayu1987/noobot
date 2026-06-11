import test from "node:test";
import assert from "node:assert/strict";
import express from "express";
import { createJsonRouteWrapper, withJsonError } from "../../routes/route-wrapper.js";
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

test("withJsonError: 默认 400，保留显式错误消息", async () => {
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
    assert.equal(response.status, HTTP_STATUS.BAD_REQUEST);
    assert.equal(payload.ok, false);
    assert.equal(payload.error, "boom");
  });
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
    jsonRoute(async () => {
      throw { message: "" };
    }, { statusCode: HTTP_STATUS.NOT_FOUND, fallbackErrorKey: "common.notFound" }),
  );
  await withTestServer(app, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/wrapper`);
    const payload = await response.json();
    assert.equal(response.status, HTTP_STATUS.NOT_FOUND);
    assert.equal(payload.ok, false);
    assert.equal(payload.error, "Not Found");
  });
});
