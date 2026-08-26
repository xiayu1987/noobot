/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import fs from "node:fs/promises";
import { clientFilePath as path } from "@noobot/client-shared/path-resolver";
import { request as playwrightRequest } from "@playwright/test";

const registryPath = String(process.env.NOOBOT_E2E_SESSION_REGISTRY || "").trim();

async function deleteSessionWithAdmissionRetry(context, { userId, sessionId, apiKey }) {
  const endpoint = `/api/internal/session/${encodeURIComponent(userId)}/${encodeURIComponent(sessionId)}`;
  for (;;) {
    const response = await context.delete(endpoint, { headers: { "x-api-key": apiKey } });
    const payload = await response.json();
    if (response.ok() && payload?.ok === true) return;
    if (response.status() !== 429) {
      throw new Error(
        `Suite Session cleanup failed (${response.status()}): ${String(payload?.error || "unknown error")}`,
      );
    }
    const retryAfterSeconds = Number(
      response.headers()["retry-after"] || payload?.retryAfterSeconds || 1,
    );
    const delayMs = Math.max(
      1000,
      Number.isFinite(retryAfterSeconds) ? retryAfterSeconds * 1000 : 1000,
    );
    await new Promise((resolve) => setTimeout(resolve, delayMs));
  }
}

async function readRegistry() {
  if (!registryPath) return [];
  try {
    const records = JSON.parse(await fs.readFile(registryPath, "utf8"));
    return Array.isArray(records) ? records : [];
  } catch (error) {
    if (error?.code === "ENOENT") return [];
    throw error;
  }
}

export async function registerSuiteSession(record) {
  if (!registryPath) throw new Error("NOOBOT_E2E_SESSION_REGISTRY is required");
  const records = await readRegistry();
  records.push({
    userId: String(record?.userId || "").trim(),
    sessionId: String(record?.sessionId || "").trim(),
    apiKey: String(record?.apiKey || "").trim(),
  });
  await fs.mkdir(path.dirname(registryPath), { recursive: true });
  await fs.writeFile(registryPath, `${JSON.stringify(records, null, 2)}\n`, { mode: 0o600 });
}

export default class SuiteSessionCleanupReporter {
  async onEnd(result) {
    const records = await readRegistry();
    if (
      process.env.NOOBOT_E2E_FULL_SUITE !== "1" ||
      result.status !== "passed" ||
      records.length === 0
    ) {
      return;
    }
    const baseURL = String(process.env.NOOBOT_E2E_BASE_URL || "http://127.0.0.1:10060").replace(
      /\/$/,
      "",
    );
    const context = await playwrightRequest.newContext({ baseURL });
    try {
      const apiKeyByUserId = new Map();
      for (const record of records) {
        const userId = String(record?.userId || "").trim();
        const apiKey = String(record?.apiKey || "").trim();
        if (userId && apiKey) apiKeyByUserId.set(userId, apiKey);
      }
      for (const record of records) {
        const userId = String(record?.userId || "").trim();
        const apiKey = apiKeyByUserId.get(userId) || "";
        await deleteSessionWithAdmissionRetry(context, {
          userId,
          sessionId: record.sessionId,
          apiKey,
        });
      }
    } finally {
      await context.dispose();
    }
    await fs.unlink(registryPath).catch((error) => {
      if (error?.code !== "ENOENT") throw error;
    });
  }
}
