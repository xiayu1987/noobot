/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import test from "node:test";
import assert from "node:assert/strict";
import express, { registerSessionRoutes, withTestServer } from "./session-routes.helpers.js";

function createReportApp(getExecutionReport) {
  const app = express();
  registerSessionRoutes(app, {
    bot: { session: { getExecutionReport } },
    handleChat: (_req, res) => res.end(),
    translateText: (key) => key,
  });
  return app;
}

test("session-routes: execution-report 按 dialogProcessId 返回单轮报告", async () => {
  const calls = [];
  const app = createReportApp(async (payload) => {
    calls.push(payload);
    return { protocol: "noobot.execution-report", status: "completed", dialogProcessId: "dp-1" };
  });
  await withTestServer(app, async (baseUrl) => {
    const response = await fetch(
      `${baseUrl}/internal/session/u1/s1/execution-report?dialogProcessId=dp-1`,
    );
    const payload = await response.json();
    assert.equal(response.status, 200);
    assert.equal(payload.ok, true);
    assert.equal(payload.report.status, "completed");
    assert.deepEqual(calls, [{ userId: "u1", sessionId: "s1", dialogProcessId: "dp-1" }]);
  });
});

test("session-routes: execution-report 缺参或非法键返回 400 且不读仓储", async () => {
  let called = false;
  const app = createReportApp(async () => {
    called = true;
    return {};
  });
  await withTestServer(app, async (baseUrl) => {
    for (const query of ["", "?dialogProcessId=", "?dialogProcessId=..%2Fescape"]) {
      const response = await fetch(`${baseUrl}/internal/session/u1/s1/execution-report${query}`);
      assert.equal(response.status, 400, `query=${query}`);
    }
    assert.equal(called, false);
  });
});

test("session-routes: execution-report 报告不存在返回 404", async () => {
  const app = createReportApp(async () => null);
  await withTestServer(app, async (baseUrl) => {
    const response = await fetch(
      `${baseUrl}/internal/session/u1/s1/execution-report?dialogProcessId=dp-missing`,
    );
    const payload = await response.json();
    assert.equal(response.status, 404);
    assert.equal(payload.ok, false);
  });
});
