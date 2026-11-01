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
import { assertSessionCommand, SESSION_ERROR_CODE } from "@noobot/session-protocol";
import {
  assertSelectedConnectorsOwned,
  CONNECTOR_SELECTION_ERROR_CODE,
} from "@noobot/connector-protocol";
import { isPathOutOfScopeError, safeJoin } from "#agent/utils";

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

test("decodeRequestInput: 仅分类明确的输入错误，保留未知故障与已有状态", () => {
  const isInvalidInput = (error) => error.code === "INVALID_INPUT";
  assert.equal(
    decodeRequestInput(() => 1, isInvalidInput),
    1,
  );
  assert.throws(
    () =>
      decodeRequestInput(() => {
        throw Object.assign(new TypeError("bad input"), { code: "INVALID_INPUT" });
      }, isInvalidInput),
    (error) => error.statusCode === HTTP_STATUS.BAD_REQUEST,
  );
  assert.throws(
    () =>
      decodeRequestInput(() => {
        const error = new Error("not found");
        error.statusCode = HTTP_STATUS.NOT_FOUND;
        throw error;
      }, isInvalidInput),
    (error) => error.statusCode === HTTP_STATUS.NOT_FOUND,
  );
  for (const failure of [new Error("internal"), new TypeError("broken decoder"), "failure"]) {
    assert.throws(
      () =>
        decodeRequestInput(() => {
          throw failure;
        }, isInvalidInput),
      (error) => error === failure && error?.statusCode === undefined,
    );
  }
});

test("decodeRequestInput: 会话命令、连接器归属与越界路径分别使用事实源错误分类", () => {
  const cases = [
    [() => assertSessionCommand({}), (error) => error.code === SESSION_ERROR_CODE.COMMAND_INVALID],
    [
      () => assertSelectedConnectorsOwned(["other"], []),
      (error) => error.code === CONNECTOR_SELECTION_ERROR_CODE.NOT_OWNED,
    ],
    [() => safeJoin("/workspace/user", "../other"), isPathOutOfScopeError],
  ];
  for (const [decode, classify] of cases) {
    assert.throws(
      () => decodeRequestInput(decode, classify),
      (error) => classify(error) && error.statusCode === HTTP_STATUS.BAD_REQUEST,
    );
  }
});

test("withJsonError: 状态码只接受 400–599 整数，未知解码故障返回 500", async () => {
  const app = express();
  const statuses = ["400", "404", null, true, 399, 600, 400.5, 0];
  app.get(
    "/status/:index",
    withJsonError(async (req) => {
      throw Object.assign(new Error("failure"), { statusCode: statuses[Number(req.params.index)] });
    }),
  );
  app.get(
    "/decode",
    withJsonError(async () => {
      decodeRequestInput(
        () => {
          throw new TypeError("broken decoder");
        },
        () => false,
      );
    }),
  );
  await withTestServer(app, async (baseUrl) => {
    for (let index = 0; index < statuses.length; index++) {
      const response = await fetch(`${baseUrl}/status/${index}`);
      assert.equal(response.status, HTTP_STATUS.INTERNAL_SERVER_ERROR);
    }
    const response = await fetch(`${baseUrl}/decode`);
    assert.equal(response.status, HTTP_STATUS.INTERNAL_SERVER_ERROR);
    assert.equal((await response.json()).error, "broken decoder");
  });
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
