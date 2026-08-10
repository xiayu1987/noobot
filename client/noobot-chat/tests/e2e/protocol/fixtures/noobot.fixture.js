/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import fs from "node:fs/promises";
import { clientFilePath as path } from "@noobot/client-shared/path-resolver";
import { expect } from "@playwright/test";
import { artifactTest } from "./artifacts.fixture.js";
import { connectThroughUi, readE2eCredentials } from "./auth.fixture.js";
import { createSessionThroughUi } from "./session.fixture.js";
import { assertModelInvocationTraceSet } from "../helpers/model-message-assertions.js";
import {
  MODEL_CALL_EXPECTATION,
  modelObservationPolicyForTitle,
} from "../helpers/model-observation-policy.js";
import {
  auditSessionSummaryArtifacts,
  modelInvocationTraces,
  readSessionExecutionEventTree,
  waitForModelInvocationTraces,
} from "../helpers/persistence-audit.js";

async function writeJsonLines(filePath, records) {
  const body = records.map((record) => JSON.stringify(record)).join("\n");
  await fs.writeFile(filePath, body ? `${body}\n` : "", "utf8");
}

async function auditModelObservation({ userId, sessionId, policy, testInfo }) {
  const outputDir = testInfo.outputPath("protocol-evidence");
  await fs.mkdir(outputDir, { recursive: true });

  let traces = modelInvocationTraces(await readSessionExecutionEventTree(userId, sessionId));
  if (policy.expectation === MODEL_CALL_EXPECTATION.REQUIRED && traces.length === 0) {
    traces = await waitForModelInvocationTraces(
      userId,
      sessionId,
      (observed) => observed.length > 0,
      { timeoutMs: 120000 },
    );
  }

  let validationError = null;
  let prefixAudit = null;
  try {
    if (traces.length > 0) {
      prefixAudit = assertModelInvocationTraceSet(traces, { rootSessionId: sessionId });
    }
    if (policy.expectation === MODEL_CALL_EXPECTATION.REQUIRED) {
      expect(traces.length, `${policy.caseId} requires an observed provider model invocation`).toBeGreaterThan(0);
    } else if (policy.expectation === MODEL_CALL_EXPECTATION.FORBIDDEN) {
      expect(traces, `${policy.caseId} forbids provider model invocations`).toEqual([]);
    }
    const expectedMainModel = String(process.env.NOOBOT_E2E_MODEL || "").trim();
    if (expectedMainModel) {
      for (const trace of traces.filter((record) => record.data?.invocation?.purpose === "main_agent")) {
        expect(trace.data?.model?.alias, `${policy.caseId} main model`).toBe(expectedMainModel);
      }
    }
    const expectedHarnessModel = String(process.env.NOOBOT_E2E_HARNESS_MODEL || "").trim();
    if (expectedHarnessModel) {
      const harnessDomains = new Set(["planning", "guidance", "acceptance"]);
      for (const trace of traces.filter((record) =>
        String(record.data?.invocation?.flow || "").startsWith("plugin.")
        && harnessDomains.has(String(record.data?.invocation?.domain || "")))) {
        expect(trace.data?.model?.alias, `${policy.caseId} Harness model`).toBe(expectedHarnessModel);
      }
    }
    const expectedMemoryModel = String(process.env.NOOBOT_E2E_MEMORY_MODEL || "").trim();
    if (expectedMemoryModel) {
      for (const trace of traces.filter((record) =>
        record.data?.invocation?.purpose === "memory_consolidation")) {
        expect(trace.data?.model?.alias, `${policy.caseId} memory model`).toBe(expectedMemoryModel);
      }
    }
  } catch (error) {
    validationError = error;
  }

  const audit = Object.freeze({
    protocolVersion: 1,
    authority: "model_invoke_port",
    caseId: policy.caseId,
    expectation: policy.expectation,
    status: validationError ? "failed" : "passed",
    failure: validationError ? String(validationError.message || validationError) : null,
    rootSessionId: sessionId,
    invocationCount: traces.length,
    invocationIdsUnique: new Set(traces.map((record) => record.data.invocationId)).size === traces.length,
    modelInstanceCount: new Set(traces.map((record) => record.data.modelInstanceId)).size,
    sessionIds: [...new Set(traces.map((record) => record.sessionId))],
    purposes: [...new Set(traces.map((record) => record.data?.invocation?.purpose).filter(Boolean))],
    domains: [...new Set(traces.map((record) => record.data?.invocation?.domain).filter(Boolean))],
    prefixStability: prefixAudit,
  });
  const tracesPath = path.join(outputDir, "model-invocations.jsonl");
  const auditPath = path.join(outputDir, "model-observation-audit.json");
  await writeJsonLines(tracesPath, traces);
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

async function auditSessionSummaryPersistence({ userId, sessionId, expectation, testInfo }) {
  const outputDir = testInfo.outputPath("protocol-evidence");
  await fs.mkdir(outputDir, { recursive: true });
  let audit;
  try {
    audit = await auditSessionSummaryArtifacts(userId, sessionId, { expectation });
  } catch (error) {
    audit = {
      ...(error?.audit || {}),
      protocolVersion: Number(error?.audit?.protocolVersion || 1),
      authority: "session_summary_artifact",
      rootSessionId: sessionId,
      status: "failed",
      failure: String(error?.message || error),
    };
    const auditPath = path.join(outputDir, "session-summary-artifact-audit.json");
    await fs.writeFile(auditPath, `${JSON.stringify(audit, null, 2)}\n`, "utf8");
    await testInfo.attach("session-summary-artifact-audit.json", {
      path: auditPath,
      contentType: "application/json",
    });
    throw error;
  }
  const auditPath = path.join(outputDir, "session-summary-artifact-audit.json");
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
    const selectedModel = String(process.env.NOOBOT_E2E_MODEL || "").trim();
    const harnessModel = String(process.env.NOOBOT_E2E_HARNESS_MODEL || "").trim();
    const memoryModel = String(process.env.NOOBOT_E2E_MEMORY_MODEL || "").trim();
    if (selectedModel || harnessModel || memoryModel) {
      await page.addInitScript(({ modelAlias, harnessModelAlias, memoryModelAlias }) => {
        if (modelAlias) {
          localStorage.setItem("noobot_selected_model", modelAlias);
          localStorage.setItem("noobot_selected_model_by_scenario", JSON.stringify({
            full: modelAlias,
          }));
          localStorage.setItem("noobot_selected_model_selection_by_scenario_v2", JSON.stringify({
            full: { value: modelAlias, source: "user" },
          }));
        }
        if (harnessModelAlias) {
          localStorage.setItem("noobot_plugin_model_config_by_scenario_v2", JSON.stringify({
            full: {
              harness: {
                stepModels: {
                  planning: harnessModelAlias,
                  guidance: harnessModelAlias,
                  acceptance: harnessModelAlias,
                  default: harnessModelAlias,
                },
              },
            },
          }));
        }
        if (memoryModelAlias) {
          localStorage.setItem("noobot_bot_scenario", "full");
          localStorage.setItem("noobot_memory_model_by_scenario_v1", JSON.stringify({
            __default__: memoryModelAlias,
            full: memoryModelAlias,
          }));
        }
      }, {
        modelAlias: selectedModel,
        harnessModelAlias: harnessModel,
        memoryModelAlias: memoryModel,
      });
    }
    await page.goto("/");
    if (memoryModel) {
      await page.evaluate((modelAlias) => {
        localStorage.setItem("noobot_memory_model_by_scenario_v1", JSON.stringify({
          __default__: modelAlias,
          full: modelAlias,
        }));
      }, memoryModel);
      await page.reload();
    }
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
      await use(Object.freeze({ page, sessionId, userId: credentials.userId, connectConfig }));
    } finally {
      const failures = [];
      try {
        await auditModelObservation({ userId: credentials.userId, sessionId, policy, testInfo });
      } catch (error) {
        failures.push(error);
      }
      try {
        await auditSessionSummaryPersistence({
          userId: credentials.userId,
          sessionId,
          expectation: policy.expectation,
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
