import test from "node:test";
import assert from "node:assert/strict";

import { createChatRunService } from "../../services/chat-run-service.js";

test("chat-run-service: normalizeRunConfig should accept canonical runTimeoutMs", () => {
  const service = createChatRunService({
    getBot: () => ({}),
    normalizeLocale: (locale = "") => String(locale || "").trim() || "zh-CN",
    defaultLocale: "zh-CN",
    translateText: (key = "") => String(key || ""),
  });

  const normalized = service.normalizeRunConfig({
    runTimeoutMs: 12345,
    locale: "en-US",
  });

  assert.equal(normalized.runTimeoutMs, 12345);
  assert.equal(normalized.locale, "en-US");
});

test("chat-run-service: normalizeRunConfig should keep canonical runTimeoutMs", () => {
  const service = createChatRunService({
    getBot: () => ({}),
    normalizeLocale: (locale = "") => String(locale || "").trim() || "zh-CN",
    defaultLocale: "zh-CN",
    translateText: (key = "") => String(key || ""),
  });

  const normalized = service.normalizeRunConfig({
    runTimeoutMs: 23456,
  });

  assert.equal(normalized.runTimeoutMs, 23456);
});
