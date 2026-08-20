/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { createHash, randomUUID } from "node:crypto";
import { test, expect } from "../fixtures/noobot.fixture.js";
import { sendMessage, waitForNaturalCompletion } from "../helpers/browser-actions.js";
import {
  modelInvocationTraces,
  readSessionExecutionEventTree,
  readSessionFact,
  waitForModelInvocationTraces,
} from "../helpers/persistence-audit.js";
import { reloadAndWaitForReconnect } from "../helpers/reconnect-scenarios.js";
import { commandsForSession, waitForCommand } from "../helpers/scenario-assertions.js";

function requiredMysqlPassword() {
  const password = String(process.env.NOOBOT_E2E_MYSQL_PASSWORD || "");
  if (!password) throw new Error("NOOBOT_E2E_MYSQL_PASSWORD is required");
  return password;
}

async function selectOption(select, text) {
  await select.click();
  const option = select.page().locator(".el-select-dropdown:visible .el-select-dropdown__item", {
    hasText: text,
  }).first();
  await expect(option).toBeVisible();
  await option.click();
}

function connectorContextMessage(connectorId, connectorName) {
  const section = {
    connectors: [
      {
        connector_id: connectorId,
        connector_name: connectorName,
        connector_type: "database",
        connector_sub_type: "mysql",
        connector_operations: [
          {
            name: "execute",
            description: "Execute one SQL statement against the configured database.",
            input_schema: {
              type: "object",
              properties: {
                command: {
                  type: "string",
                  description: "SQL statement to execute.",
                },
              },
              required: ["command"],
              additionalProperties: false,
            },
          },
        ],
      },
    ],
  };
  return `# Current connector information\n${JSON.stringify(section, null, 2)}`;
}

function diagnosticContentHash(content) {
  return createHash("sha256").update(content).digest("hex").slice(0, 16);
}

test("@full PBE-047 添加 MySQL 连接器、选择、查询及上下文与 Session 审计", async ({
  noobot,
  protocolCapture,
}) => {
  await sendMessage(noobot.page, "Reply with OK only.");
  const provisionCommand = await waitForCommand(protocolCapture, noobot.sessionId, "turn.send");
  expect(provisionCommand.session).toEqual({
    createIfAbsent: true,
    selectedConnectorIds: [],
  });
  await waitForNaturalCompletion({
    page: noobot.page,
    capture: protocolCapture,
    sessionId: noobot.sessionId,
    turnScopeId: provisionCommand.identity.turnScopeId,
  });
  await reloadAndWaitForReconnect(noobot.page, protocolCapture);
  await expect(noobot.page.locator(".session-item.active")).toHaveAttribute(
    "data-session-id",
    noobot.sessionId,
  );

  const connectorName = `e2e-mysql-${randomUUID().slice(0, 8)}`;
  const overview = noobot.page.locator(".connector-overview-panel");
  await overview.locator(".chat-message-nav-icon-button").click();
  await overview.locator(".manager-actions .el-button--primary").click();

  const drawer = noobot.page.locator(".connector-add-drawer");
  await expect(drawer).toBeVisible();
  await drawer.getByRole("textbox", { name: /^\*?(名称|Name)$/i }).fill(connectorName);
  const connectorTypeSelects = drawer.locator(".type-grid .el-select");
  await selectOption(connectorTypeSelects.nth(0), "database");
  await selectOption(connectorTypeSelects.nth(1), "mysql");
  await drawer.getByRole("textbox", { name: /^\*?(主机|Host)$/i }).fill("127.0.0.1");
  await drawer.getByRole("spinbutton", { name: /^(端口|Port)$/i }).fill("3306");
  await drawer.getByRole("textbox", { name: /^\*?(用户名|Username)$/i }).fill("root");
  await drawer.getByRole("textbox", { name: /^\*?(密码|Password)$/i }).fill(requiredMysqlPassword());
  await drawer.getByRole("textbox", { name: /^\*?(数据库|Database)$/i }).fill("test_db");

  const createdResponse = noobot.page.waitForResponse(
    (response) =>
      /\/internal\/connectors\/[^/]+$/.test(new URL(response.url()).pathname) &&
      response.request().method() === "POST",
  );
  await drawer.getByRole("button", { name: /连接|Connect/i }).click();
  expect((await createdResponse).ok()).toBe(true);
  await expect(overview.locator(".connector-row", { hasText: connectorName })).toContainText(
    /已连接|connected/i,
  );

  await noobot.page.locator(".composer-icon-btn").first().click();
  const connectorOption = noobot.page.locator(".connector-option", { hasText: connectorName });
  await expect(connectorOption).toBeVisible();

  let releaseSelectionWrite;
  let markSelectionWriteStarted;
  const selectionWriteStarted = new Promise((resolve) => {
    markSelectionWriteStarted = resolve;
  });
  const selectionWriteGate = new Promise((resolve) => {
    releaseSelectionWrite = resolve;
  });
  await noobot.page.route("**/selection", async (route) => {
    markSelectionWriteStarted();
    await selectionWriteGate;
    await route.continue();
  });
  const selectionResponse = noobot.page.waitForResponse(
    (response) =>
      response.url().endsWith("/selection") && response.request().method() === "PUT",
  );
  await connectorOption.click();
  await selectionWriteStarted;
  await noobot.page.locator(".more-collapse-btn").click();

  const pendingSend = sendMessage(
    noobot.page,
    "必须使用已选择的数据库连接器执行 SELECT * FROM users WHERE 1=1; 并返回查询结果。",
  );
  await noobot.page.waitForTimeout(250);
  expect(commandsForSession(protocolCapture, noobot.sessionId)).toHaveLength(1);

  releaseSelectionWrite();
  const selectionHttpResponse = await selectionResponse;
  expect(selectionHttpResponse.ok()).toBe(true);
  const selectionPayload = await selectionHttpResponse.json();
  expect(selectionPayload.selectedConnectorIds).toHaveLength(1);
  const [connectorId] = selectionPayload.selectedConnectorIds;
  await pendingSend;
  await expect(connectorOption.locator(".el-checkbox__input")).toHaveClass(/is-checked/);

  const command = await waitForCommand(protocolCapture, noobot.sessionId, "turn.send", 1);
  expect(command.session).toEqual({ createIfAbsent: false, selectedConnectorIds: [] });
  await waitForNaturalCompletion({
    page: noobot.page,
    capture: protocolCapture,
    sessionId: noobot.sessionId,
    turnScopeId: command.identity.turnScopeId,
  });

  const session = await readSessionFact(noobot.userId, noobot.sessionId);
  expect(session.selectedConnectorIds).toEqual([connectorId]);
  const executionEvents = await readSessionExecutionEventTree(noobot.userId, noobot.sessionId);
  const connectorCall = executionEvents.find(
    (record) =>
      record.event === "tool_call_end" &&
      record.turnScopeId === command.identity.turnScopeId &&
      record.data?.tool === "access_connector",
  );
  expect(connectorCall?.data?.success).toBe(true);
  const connectorCallStart = executionEvents.find(
    (record) =>
      record.event === "tool_call_start" &&
      record.turnScopeId === command.identity.turnScopeId &&
      record.data?.toolCallId === connectorCall.data.toolCallId,
  );
  expect(connectorCallStart?.data?.args).toEqual({
    connector_id: connectorId,
    operation: "execute",
    input: { command: "SELECT * FROM users WHERE 1=1;" },
  });

  let traces = modelInvocationTraces(executionEvents).filter(
    (record) => record.turnScopeId === command.identity.turnScopeId,
  );
  if (!traces.length) {
    traces = await waitForModelInvocationTraces(
      noobot.userId,
      noobot.sessionId,
      (records) => records.some((record) => record.turnScopeId === command.identity.turnScopeId),
      { timeoutMs: 120000 },
    );
    traces = traces.filter((record) => record.turnScopeId === command.identity.turnScopeId);
  }
  const expectedConnectorContext = connectorContextMessage(connectorId, connectorName);
  const primaryEvidence = traces
    .filter((record) => record.data?.invocation?.flow === "agent.main")
    .flatMap((record) => record.data?.messages?.evidence || []);
  expect(primaryEvidence).toContainEqual(
    expect.objectContaining({
      role: "system",
      contentLength: expectedConnectorContext.length,
      contentHash: diagnosticContentHash(expectedConnectorContext),
    }),
  );
});
