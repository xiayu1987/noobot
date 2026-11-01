/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import test from "node:test";
import assert from "node:assert/strict";
import { requireRunLocale } from "@noobot/agent-config-protocol";
import { normalizeOptions } from "../../src/core/options.js";
import {
  getWorkflowDefaultSemanticPrompt,
  resolveWorkflowLocaleFromContext,
} from "../../src/core/i18n.js";
import { resolveSemanticText } from "../../src/core/orchestrator/semantic-resolution.js";
import { parseWorkflowSemantic } from "../../src/workflow/adapter.js";

function context(locale) {
  return {
    runConfig: { locale },
    locale: "zh-CN",
    userMessage: "plan",
    userMessageAttachments: [],
    agentContext: {
      runConfig: { locale: "zh-CN" },
      bindings: {
        tools: [{ name: "read_file" }],
        runtime: {
          systemRuntime: { config: { locale: "zh-CN" } },
          userConfig: { locale: "zh-CN" },
          globalConfig: { locale: "zh-CN" },
        },
      },
    },
  };
}

for (const locale of ["en-US", "zh-CN"]) {
  test(`workflow prompt and semantic invocation use run locale ${locale}`, async () => {
    const ctx = context(locale);
    const before = structuredClone(ctx);
    const calls = [];
    const options = {
      ...normalizeOptions({ locale: locale === "en-US" ? "zh-CN" : "en-US" }),
      resolveModelMessages: () => [],
      capabilityModelInvoker: async (request) => {
        calls.push(request);
        return { output: { text: "semantic" } };
      },
    };
    assert.equal(Object.hasOwn(options, "locale"), false);
    await resolveSemanticText({
      options,
      ctx,
      signal: new AbortController().signal,
      sourceText: "source",
    });
    assert.equal(calls.length, 1);
    assert.equal(calls[0].locale, locale);
    assert.equal(calls[0].messages[0].content, getWorkflowDefaultSemanticPrompt(locale));
    assert.equal(resolveWorkflowLocaleFromContext(ctx), locale);
    assert.deepEqual(ctx, before);
  });
}

test("custom semantic prompt is preserved independently of run locale", async () => {
  let request;
  await resolveSemanticText({
    options: {
      ...normalizeOptions({ semanticPrompt: "custom prompt" }),
      resolveModelMessages: () => [],
      capabilityModelInvoker: async (value) => {
        request = value;
        return { output: { text: "semantic" } };
      },
    },
    ctx: context("en-US"),
    signal: new AbortController().signal,
    sourceText: "source",
  });
  assert.equal(request.messages[0].content, "custom prompt");
  assert.equal(request.locale, "en-US");
});

for (const locale of [undefined, null, "", "en", " en-US", "fr-FR", 1]) {
  test(`invalid run locale ${String(locale)} rejects before model invocation`, async () => {
    const ctx = context(locale);
    const before = structuredClone(ctx);
    let invoked = false;
    assert.throws(() => requireRunLocale(ctx.runConfig), /invalid_run_locale/);
    await assert.rejects(
      resolveSemanticText({
        options: {
          capabilityModelInvoker: () => {
            invoked = true;
          },
        },
        ctx,
        signal: new AbortController().signal,
        sourceText: "source",
      }),
      /invalid_run_locale/,
    );
    assert.equal(invoked, false);
    assert.deepEqual(ctx, before);
  });
}

test("missing run config is rejected despite alternate context locales", () => {
  const ctx = context("en-US");
  delete ctx.runConfig;
  assert.throws(() => resolveWorkflowLocaleFromContext(ctx), /invalid_run_locale/);
});

test("semantic parser diagnostics use the supplied run locale", () => {
  const diagnostics = [];
  for (const locale of ["en-US", "zh-CN"]) {
    assert.throws(
      () => parseWorkflowSemantic({ semanticText: "invalid", locale }),
      (error) => {
        diagnostics.push(error.message);
        return true;
      },
    );
  }
  assert.notEqual(diagnostics[0], diagnostics[1]);
});
