import test from "node:test";
import assert from "node:assert/strict";

import {
  createTemplateResolveContext,
  resolveConfigSecrets,
  resolveConfigTemplates,
} from "../../../system-core/config/core/template-resolver.js";

test("createTemplateResolveContext: 应生成大小写无关查询映射", () => {
  const ctx = createTemplateResolveContext({
    configParams: { Api_Key: "k1" },
    env: { Token: "t1" },
  });
  assert.equal(ctx.lowerCaseParamKeyMap.api_key, "k1");
  assert.equal(ctx.lowerCaseEnvKeyMap.token, "t1");
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
