import test from "node:test";
import assert from "node:assert/strict";

import { runWeb2Img } from "../../../src/system-core/utils/web/web2img.js";
import { browserLikeFetch } from "../../../src/system-core/utils/web/fetch.js";
import { NoobotError } from "../../../src/system-core/error/index.js";

test("runWeb2Img throws recoverable error when input/outputDir is missing", async () => {
  await assert.rejects(
    runWeb2Img({ input: "", outputDir: "" }),
    (error) =>
      error instanceof NoobotError &&
      error.code === "RECOVERABLE_INPUT_MISSING" &&
      error.fatal === false,
  );
});

test("browserLikeFetch throws recoverable error when redirects exceed limit", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => ({
    status: 302,
    headers: {
      get(name) {
        if (String(name).toLowerCase() === "location") {
          return "https://example.com/redirect-next";
        }
        return "";
      },
    },
  });

  try {
    await assert.rejects(
      browserLikeFetch("https://example.com/start", { maxRedirects: 0 }),
      (error) =>
        error instanceof NoobotError &&
        error.code === "RECOVERABLE_TOO_MANY_REDIRECTS" &&
        error.fatal === false,
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

