/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import fs from "node:fs/promises";
import { clientFilePath as path } from "@noobot/client-shared/path-resolver";
import { expect } from "@playwright/test";
import { splitServerNow } from "@noobot/session-protocol/server-clock";
import { artifactTest } from "./artifacts.fixture.js";
import { connectThroughUi, readE2eCredentials } from "./auth.fixture.js";
import { createSessionThroughUi } from "./session.fixture.js";
import {
  createModelInvocationTraceAudit,
  assertModelSystemMessages,
} from "../helpers/model-message-assertions.js";
import {
  MODEL_CALL_EXPECTATION,
  modelObservationPolicyForTitle,
} from "../helpers/model-observation-policy.js";
import {
  auditSessionSummaryArtifacts,
  modelInvocationTraces,
  iterateSessionExecutionEventTree,
  waitForModelInvocationTraces,
} from "../helpers/persistence-audit.js";
import { registerSuiteSession } from "../suite-session-cleanup.js";
import { PROTOCOL_TIMEOUTS } from "../helpers/protocol-timeouts.js";
import { text } from "@noobot/shared/value";
import { PERF_HARNESS_MODELS } from "../../../../../../scripts/mock-model-service/performance-contract.mjs";

const E2E_MODEL_ALIAS = text(process.env.NOOBOT_E2E_MODEL_ALIAS) || "GLM_5_3";
const E2E_STREAM_OUTPUT = text(process.env.NOOBOT_E2E_STREAM_OUTPUT).toLowerCase() === "true";

export async function installE2eModelPreferences(pageOrContext) {
  const e2eUserId = readE2eCredentials().userId;
  await pageOrContext.addInitScript(
    ({ modelAlias, userId, streamOutput, harnessModels }) => {
      if (location.protocol !== "http:" && location.protocol !== "https:") return;
      const setInitialValue = (key, value, { force = false } = {}) => {
        if (force || localStorage.getItem(key) === null) localStorage.setItem(key, value);
      };
      const scenarioModels = { full: modelAlias, programming: modelAlias, text: modelAlias };
      const scenarioSelections = Object.fromEntries(
        Object.entries(scenarioModels).map(([scenario, value]) => [
          scenario,
          { value, source: "user" },
        ]),
      );
      const pluginModels = Object.fromEntries(
        Object.keys(scenarioModels).map((scenario) => [
          scenario,
          {
            harness: {
              stepModels: {
                planning: modelAlias,
                guidance: modelAlias,
                acceptance: modelAlias,
                default: modelAlias,
                ...harnessModels,
              },
            },
            workflow: { semanticModel: modelAlias },
          },
        ]),
      );
      setInitialValue("noobot_selected_model", modelAlias, { force: true });
      setInitialValue("noobot_stream_output", streamOutput ? "true" : "false", { force: true });
      setInitialValue("noobot_safe_confirm", "false", { force: true });
      setInitialValue("noobot_selected_model_by_scenario", JSON.stringify(scenarioModels), {
        force: true,
      });
      setInitialValue(
        "noobot_selected_model_selection_by_scenario_v2",
        JSON.stringify(scenarioSelections),
        { force: true },
      );
      setInitialValue(
        "noobot_plugin_preferences",
        JSON.stringify({ version: 1, scenarios: pluginModels }),
        { force: true },
      );
      setInitialValue("noobot_bot_scenario", "full");
      setInitialValue(
        "noobot_memory_model_by_scenario_v1",
        JSON.stringify({ __default__: modelAlias, ...scenarioModels }),
        { force: true },
      );
      const pluginBaselineKey = "noobot_e2e_plugin_baseline_initialized";
      if (sessionStorage.getItem(pluginBaselineKey) !== "1") {
        localStorage.setItem(`noobot_selected_plugins:${encodeURIComponent(userId)}`, "[]");
        sessionStorage.setItem(pluginBaselineKey, "1");
      }
    },
    {
      modelAlias: E2E_MODEL_ALIAS,
      userId: e2eUserId,
      streamOutput: E2E_STREAM_OUTPUT,
      harnessModels: process.env.NOOBOT_E2E_PERF === "1" ? PERF_HARNESS_MODELS : {},
    },
  );
}

function expectedModelAlias(invocation) {
  if (process.env.NOOBOT_E2E_PERF !== "1" || !invocation.flow.startsWith("harness."))
    return E2E_MODEL_ALIAS;
  const alias = PERF_HARNESS_MODELS[invocation.purpose];
  if (!alias) throw new TypeError(`Unknown Harness model purpose: ${invocation.purpose}`);
  return alias;
}

async function auditModelObservation({ userId, sessionId, policy, testInfo }) {
  const outputDir = testInfo.outputPath("protocol-evidence");
  await fs.mkdir(outputDir, { recursive: true });
  let validationError = null;
  let prefixAudit = null;
  const traceAudit = createModelInvocationTraceAudit({ rootSessionId: sessionId });
  const systemMessageAudit = {
    status: "passed",
    invocationCount: 0,
    mainInvocationCount: 0,
    nonMainInvocationCount: 0,
    systemMessageCount: 0,
    violations: [],
    invocations: [],
  };
  const identities = Object.fromEntries(
    ["invocationId", "modelInstanceId", "sessionId", "purpose", "domain", "alias"].map((key) => [
      key,
      new Set(),
    ]),
  );
  let attemptCount = 0;
  const tracesPath = path.join(outputDir, "model-invocations.jsonl");
  const file = await fs.open(tracesPath, "w");
  try {
    for await (const record of iterateSessionExecutionEventTree(userId, sessionId)) {
      if (!modelInvocationTraces([record]).length) continue;
      await file.write(`${JSON.stringify(record)}\n`);
      attemptCount += 1;
      const invocation = record.data.invocation;
      for (const [key, value] of Object.entries({
        invocationId: record.data.invocationId,
        modelInstanceId: record.data.modelInstanceId,
        sessionId: record.sessionId,
        purpose: invocation?.purpose,
        domain: invocation?.domain,
        alias: record.data.model?.alias,
      })) {
        if (value) identities[key].add(value);
      }
      try {
        traceAudit.observe(record);
        const system = assertModelSystemMessages([record]);
        for (const key of [
          "invocationCount",
          "mainInvocationCount",
          "nonMainInvocationCount",
          "systemMessageCount",
        ])
          systemMessageAudit[key] += system[key];
        systemMessageAudit.invocations.push(...system.invocations);
        expect(record.data.model?.alias, `${policy.caseId} model (${invocation.flow})`).toBe(
          expectedModelAlias(invocation),
        );
      } catch (error) {
        validationError ||= error;
      }
    }
  } finally {
    await file.close();
  }
  if (policy.expectation === MODEL_CALL_EXPECTATION.REQUIRED && attemptCount === 0) {
    await waitForModelInvocationTraces(userId, sessionId, (observed) => observed.length > 0, {
      timeoutMs: PROTOCOL_TIMEOUTS.model,
    });
    return auditModelObservation({ userId, sessionId, policy, testInfo });
  }
  try {
    if (attemptCount > 0) prefixAudit = traceAudit.finish();
    if (policy.expectation === MODEL_CALL_EXPECTATION.REQUIRED) {
      expect(
        attemptCount,
        `${policy.caseId} requires an observed provider model invocation`,
      ).toBeGreaterThan(0);
    } else if (policy.expectation === MODEL_CALL_EXPECTATION.FORBIDDEN) {
      expect(attemptCount, `${policy.caseId} forbids provider model invocations`).toBe(0);
    }
  } catch (error) {
    validationError ||= error;
  }

  const audit = Object.freeze({
    protocolVersion: 2,
    authority: "model_invoke_port",
    caseId: policy.caseId,
    expectation: policy.expectation,
    status: validationError ? "failed" : "passed",
    failure: validationError ? String(validationError.message || validationError) : null,
    rootSessionId: sessionId,
    invocationCount: identities.invocationId.size,
    attemptCount,
    modelInstanceCount: identities.modelInstanceId.size,
    sessionIds: [...identities.sessionId],
    purposes: [...identities.purpose],
    domains: [...identities.domain],
    aliases: [...identities.alias],
    prefixStability: prefixAudit,
    systemMessages: systemMessageAudit,
  });
  const auditPath = path.join(outputDir, "model-observation-audit.json");
  await fs.writeFile(auditPath, `${JSON.stringify(audit, null, 2)}\n`, "utf8");
  await testInfo.attach("model-invocations.jsonl", {
    path: tracesPath,
    contentType: "application/x-ndjson",
  });
  await testInfo.attach("model-observation-audit.json", {
    path: auditPath,
    contentType: "application/json",
  });
  if (validationError) throw validationError;
}

async function readSessionDetail({ page, apiKey, userId, sessionId }) {
  const response = await page.request.get(
    `/api/internal/session/${encodeURIComponent(userId)}/${encodeURIComponent(sessionId)}`,
    { headers: { "x-api-key": apiKey } },
  );
  expect(response.ok(), "session detail read must succeed before artifact audit").toBe(true);
  const { document: detail } = splitServerNow(await response.json());
  expect(detail.ok).toBe(true);
  return detail;
}

async function auditSessionSummaryPersistence({
  detail,
  userId,
  sessionId,
  expectation,
  testInfo,
}) {
  const outputDir = testInfo.outputPath("protocol-evidence");
  await fs.mkdir(outputDir, { recursive: true });
  let audit;
  try {
    if (expectation === "required") {
      expect(detail.exists).toBe(true);
      expect(detail.sessions.length).toBeGreaterThan(0);
      for (const session of detail.sessions) expect(session.availability).toBe("available");
    }
    audit = await auditSessionSummaryArtifacts(userId, sessionId, {
      expectation,
      requiredTitlePrefix: expectation === "required" ? "[PBE:" : "",
    });
  } catch (error) {
    audit = {
      ...(error?.audit || {}),
      protocolVersion: 2,
      authority: "immutable_session_projection",
      rootSessionId: sessionId,
      status: "failed",
      failure: String(error?.message || error),
    };
    const auditPath = path.join(outputDir, "session-summary-artifact-audit.json");
    await fs.mkdir(outputDir, { recursive: true });
    await fs.writeFile(auditPath, `${JSON.stringify(audit, null, 2)}\n`, "utf8");
    await testInfo.attach("session-summary-artifact-audit.json", {
      path: auditPath,
      contentType: "application/json",
    });
    throw error;
  }
  const auditPath = path.join(outputDir, "session-summary-artifact-audit.json");
  await fs.mkdir(outputDir, { recursive: true });
  await fs.writeFile(auditPath, `${JSON.stringify(audit, null, 2)}\n`, "utf8");
  await testInfo.attach("session-summary-artifact-audit.json", {
    path: auditPath,
    contentType: "application/json",
  });
}

export const test = artifactTest.extend({
  noobot: async ({ page }, use, testInfo) => {
    const credentials = readE2eCredentials();
    const policy = modelObservationPolicyForTitle(testInfo.title);
    await installE2eModelPreferences(page);
    await page.goto("/");
    const connectConfig = await connectThroughUi(page, credentials);
    const { apiKey: _apiKey, ...publicConnectConfig } = connectConfig || {};
    const connectEvidenceDir = testInfo.outputPath("protocol-evidence");
    const connectEvidencePath = path.join(connectEvidenceDir, "connect-config.json");
    await fs.mkdir(connectEvidenceDir, { recursive: true });
    await fs.writeFile(
      connectEvidencePath,
      `${JSON.stringify(publicConnectConfig, null, 2)}\n`,
      "utf8",
    );
    await testInfo.attach("connect-config.json", {
      path: connectEvidencePath,
      contentType: "application/json",
    });
    const sessionId = await createSessionThroughUi(page);
    try {
      await use(
        Object.freeze({
          page,
          sessionId,
          userId: credentials.userId,
          connectConfig,
          modelAlias: E2E_MODEL_ALIAS,
        }),
      );
    } finally {
      const failures = [];
      try {
        await auditModelObservation({ userId: credentials.userId, sessionId, policy, testInfo });
      } catch (error) {
        failures.push(error);
      }
      try {
        const detail = await readSessionDetail({
          page,
          apiKey: connectConfig.apiKey,
          userId: credentials.userId,
          sessionId,
        });
        if (detail.exists) {
          await registerSuiteSession({ userId: credentials.userId, sessionId });
        }
        await auditSessionSummaryPersistence({
          detail,
          userId: credentials.userId,
          sessionId,
          expectation: policy.summaryExpectation,
          testInfo,
        });
      } catch (error) {
        failures.push(error);
      }
      if (failures.length === 1) throw failures[0];
      if (failures.length > 1) throw new AggregateError(failures, "protocol final audits failed");
    }
  },
});

export { expect };
