/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import test from "node:test";
import assert from "node:assert/strict";

import {
  createTemplateResolveContext,
  resolveConfigSecrets,
  resolveConfigTemplates,
} from "../../../src/system-core/config/core/template-resolver.js";

test("createTemplateResolveContext: 应生成大写参数查询映射", () => {
  const ctx = createTemplateResolveContext({
    configParams: { Api_Key: "k1" },
    env: { Token: "t1" },
  });
  assert.equal(ctx.upperCaseParamKeyMap.API_KEY, "k1");
  assert.equal(ctx.upperCaseEnvKeyMap.TOKEN, "t1");
});

test("resolveConfigSecrets: 应优先使用 env，再回退到 configParams", () => {
  const out = resolveConfigSecrets(
    {
      provider: {
        apiKey: "${API_KEY}",
        token: "${TOKEN}",
        region: "${REGION}",
      },
    },
    {
      configParams: { API_KEY: "param-key", REGION: "cn" },
      env: { API_KEY: "env-key", TOKEN: "env-token" },
    },
  );

  assert.equal(out.provider.apiKey, "env-key");
  assert.equal(out.provider.token, "env-token");
  assert.equal(out.provider.region, "cn");
});

test("resolveConfigSecrets: 未命中变量应替换为空字符串", () => {
  const out = resolveConfigSecrets(
    { text: "hello-${NOT_FOUND}-world" },
    { configParams: {}, env: {} },
  );
  assert.equal(out.text, "hello--world");
});

test("resolveConfigSecrets: 小写占位符不作为配置变量解析", () => {
  const out = resolveConfigSecrets(
    {
      upper: "${API_KEY}",
      lower: "${api_key}",
      mixed: "${Api_Key}",
    },
    {
      configParams: { API_KEY: "param-key" },
      env: { API_KEY: "env-key" },
    },
  );

  assert.equal(out.upper, "env-key");
  assert.equal(out.lower, "${api_key}");
  assert.equal(out.mixed, "${Api_Key}");
});

test("resolveConfigSecrets: 应递归处理数组和对象", () => {
  const out = resolveConfigSecrets(
    {
      list: ["${A}", { v: "${B}" }],
      s: "${C}",
      n: 1,
    },
    { configParams: { A: "a", B: "b", C: "c" }, env: {} },
  );
  assert.deepEqual(out, {
    list: ["a", { v: "b" }],
    s: "c",
    n: 1,
  });
});

test("resolveConfigTemplates: 应仅使用 variables（不读取 env）", () => {
  const out = resolveConfigTemplates(
    { key: "${API_KEY}" },
    { API_KEY: "from-variables" },
  );
  assert.equal(out.key, "from-variables");
});
