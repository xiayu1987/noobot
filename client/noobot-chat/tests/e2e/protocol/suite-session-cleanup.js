/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import fs from "node:fs/promises";
import path from "node:path";
import { request as playwrightRequest } from "@playwright/test";

const registryPath = String(process.env.NOOBOT_E2E_SESSION_REGISTRY || "").trim();

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
    if (result.status !== "passed" || records.length === 0) return;
    const baseURL = String(process.env.NOOBOT_E2E_BASE_URL || "http://127.0.0.1:10060").replace(/\/$/, "");
    const context = await playwrightRequest.newContext({ baseURL });
    try {
      for (const record of records) {
        const response = await context.delete(
          `/api/internal/session/${encodeURIComponent(record.userId)}/${encodeURIComponent(record.sessionId)}`,
          { headers: { "x-api-key": record.apiKey } },
        );
        const payload = await response.json();
        if (!response.ok() || payload?.ok !== true) {
          throw new Error(`Suite Session cleanup failed (${response.status()}): ${String(payload?.error || "unknown error")}`);
        }
      }
    } finally {
      await context.dispose();
    }
    await fs.unlink(registryPath).catch((error) => {
      if (error?.code !== "ENOENT") throw error;
    });
  }
}
