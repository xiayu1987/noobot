/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import test from "node:test";
import assert from "node:assert/strict";

import {
  createConfigValueLookup,
  resolveConfigTemplates,
} from "@noobot/agent-config-protocol";

test("createConfigValueLookup: 应按来源优先级生成大写参数查询", () => {
  const lookup = createConfigValueLookup({ Token: "t1" }, { Api_Key: "k1" });
  assert.equal(lookup("API_KEY"), "k1");
  assert.equal(lookup("TOKEN"), "t1");
});

test("resolveConfigTemplates: 应优先使用 env，再回退到 configParams", () => {
  const out = resolveConfigTemplates(
    {
      provider: {
        apiKey: "${API_KEY}",
        token: "${TOKEN}",
        region: "${REGION}",
      },
    },
    { lookup: createConfigValueLookup(
      { API_KEY: "env-key", TOKEN: "env-token" },
      { API_KEY: "param-key", REGION: "cn" },
    ) },
  );

  assert.equal(out.provider.apiKey, "env-key");
  assert.equal(out.provider.token, "env-token");
  assert.equal(out.provider.region, "cn");
});

test("resolveConfigTemplates: 未命中变量应替换为空字符串", () => {
  const out = resolveConfigTemplates(
    { text: "hello-${NOT_FOUND}-world" },
    { lookup: createConfigValueLookup() },
  );
  assert.equal(out.text, "hello--world");
});

test("resolveConfigTemplates: 小写占位符不作为配置变量解析", () => {
  const out = resolveConfigTemplates(
    {
      upper: "${API_KEY}",
      lower: "${api_key}",
      mixed: "${Api_Key}",
    },
    { lookup: createConfigValueLookup({ API_KEY: "env-key" }, { API_KEY: "param-key" }) },
  );

  assert.equal(out.upper, "env-key");
  assert.equal(out.lower, "${api_key}");
  assert.equal(out.mixed, "${Api_Key}");
});

test("resolveConfigTemplates: 应递归处理数组和对象", () => {
  const out = resolveConfigTemplates(
    {
      list: ["${A}", { v: "${B}" }],
      s: "${C}",
      n: 1,
    },
    { lookup: createConfigValueLookup({}, { A: "a", B: "b", C: "c" }) },
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
    { lookup: createConfigValueLookup({ API_KEY: "from-variables" }) },
  );
  assert.equal(out.key, "from-variables");
});
