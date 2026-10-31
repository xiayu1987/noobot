/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

const WEB_SEARCH_I18N = Object.freeze({
  bodyFormatInvalid: {
    "zh-CN": "body 格式错误：此服务不接受 body，请使用 queryString。",
    "en-US": "Invalid body format: this service does not accept body, use queryString.",
  },
  queryStringMissingSearch: {
    "zh-CN": "queryString 格式错误：缺少 search。",
    "en-US": "Invalid queryString format: missing search.",
  },
  customParamInvalidUrl: {
    "zh-CN": "custom_param 必须是有效的实例 URL",
    "en-US": "custom_param must be a valid instance URL",
  },
  customParamNotInInstances: {
    "zh-CN": "custom_param 不在 SEARX 实例列表中",
    "en-US": "custom_param is not in the SEARX instance list",
  },
  upstreamRejected: {
    "zh-CN": "搜索服务拒绝了请求",
    "en-US": "The search provider rejected the request",
  },
  allProvidersFailed: {
    "zh-CN": "主搜索服务与所有备用实例均不可用",
    "en-US": "The primary provider and all fallback instances are unavailable",
  },
  resultContentLimited: {
    "zh-CN": "搜索内容有限，请减少关键字，扩大范围搜索",
    "en-US": "Limited search content. Please reduce keywords and broaden your search scope.",
  },
});

const SEARX_INSTANCES_YAML_URL =
  "https://raw.githubusercontent.com/searxng/searx-instances/master/searxinstances/instances.yml";
const REMOTE_INSTANCE_CACHE_TTL_MS = 60 * 60 * 1000;
const LIMITED_CONTENT_CHARS = 2000;
let remoteInstanceCache = null;

function tWebSearch(locale, key) {
  const message = WEB_SEARCH_I18N[key][locale];
  if (typeof message !== "string") throw new TypeError(`web-search text missing: ${key}.${locale}`);
  return message;
}

function normalizeInstanceUrl(value) {
  return new URL(String(value).trim()).toString().replace(/\/+$/, "");
}

function failure(code, error, output) {
  return { ok: false, error, code, output };
}

function errorText(error) {
  return error instanceof Error ? error.message : String(error);
}

function parseSearxInstancesYaml(yamlText) {
  const out = new Set();
  for (const line of yamlText.split(/\r?\n/)) {
    const matched = line.trim().match(/^(https?:\/\/.+):\s*\{\s*\}\s*$/);
    if (matched) out.add(normalizeInstanceUrl(matched[1]));
  }
  return [...out];
}

async function loadRemoteInstances(fetcher, registryAttempt) {
  const now = Date.now();
  if (remoteInstanceCache && now - remoteInstanceCache.fetchedAt < REMOTE_INSTANCE_CACHE_TTL_MS) {
    return remoteInstanceCache.instances;
  }
  try {
    const res = await fetcher(SEARX_INSTANCES_YAML_URL, { method: "GET" });
    if (!res.ok) {
      registryAttempt.error = `registry responded ${res.status}`;
      return [];
    }
    const instances = parseSearxInstancesYaml(await res.text());
    remoteInstanceCache = { fetchedAt: now, instances };
    return instances;
  } catch (error) {
    registryAttempt.error = errorText(error);
    return [];
  }
}

async function readResponseData(res, { textCleaner, requestUrl, locale }) {
  const contentType = String(res.headers.get("content-type") ?? "");
  if (contentType.includes("application/json")) return await res.json();
  const raw = await res.text();
  const cleaned = String(textCleaner.cleanAny(raw, { contentType, url: requestUrl }));
  const finalText =
    cleaned.length < LIMITED_CONTENT_CHARS
      ? `${cleaned}\n\n${tWebSearch(locale, "resultContentLimited")}`
      : cleaned;
  return {
    type: "cleaned_text",
    text: finalText,
    original_length: raw.length,
    cleaned_length: finalText.length,
    content_type: contentType,
  };
}

async function attemptRequest({ fetcher, url, headers, attempts, readOptions }) {
  const attempt = { url };
  attempts.push(attempt);
  try {
    const res = await fetcher(url, { method: "GET", headers });
    attempt.httpStatus = res.status;
    const data = await readResponseData(res, { ...readOptions, requestUrl: url });
    return { res, data };
  } catch (error) {
    attempt.error = errorText(error);
    return null;
  }
}

function resolveCandidateInstances({ failureCode, customParam, instances, locale, attempts }) {
  const requested = String(customParam ?? "").trim();
  if (!requested) return { candidates: instances };
  let normalized;
  try {
    normalized = normalizeInstanceUrl(requested);
  } catch (error) {
    return {
      failure: failure(failureCode.INPUT_INVALID, tWebSearch(locale, "customParamInvalidUrl"), {
        attempts,
        cause: errorText(error),
      }),
    };
  }
  if (!instances.includes(normalized)) {
    return {
      failure: failure(failureCode.INPUT_INVALID, tWebSearch(locale, "customParamNotInInstances"), {
        attempts,
      }),
    };
  }
  return { candidates: [normalized] };
}

function fallbackSearchUrl(base, query) {
  const target = new URL("/search", `${base}/`);
  target.searchParams.set("q", query);
  target.searchParams.set("format", "json");
  return target.toString();
}

function success({ res, data }, extra) {
  return { ok: true, output: { httpStatus: res.status, ...extra, data } };
}

function primaryRequestUrl(endpointCfg, query) {
  const url = new URL(String(endpointCfg.url));
  url.searchParams.set("q", query);
  url.searchParams.set("format", String(endpointCfg.custom_param_format).trim());
  return url.toString();
}

function inputFailure(failureCode, locale, key, endpointCfg) {
  return failure(failureCode.INPUT_INVALID, tWebSearch(locale, key), {
    expectedFormat: {
      queryString: String(endpointCfg.query_string_format ?? ""),
      body: String(endpointCfg.body_format ?? ""),
    },
  });
}

export default async function webSearchServiceHandler({
  runtime,
  locale,
  failureCode,
  endpointCfg,
  serviceCfg,
  custom_param,
  queryString,
  body,
}) {
  if (body !== undefined)
    return inputFailure(failureCode, locale, "bodyFormatInvalid", endpointCfg);
  const query = queryString === undefined ? "" : String(queryString.search ?? "").trim();
  if (!query) return inputFailure(failureCode, locale, "queryStringMissingSearch", endpointCfg);

  const fetcher = runtime.sharedTools.fetch;
  const readOptions = { textCleaner: runtime.sharedTools.textCleaner, locale };
  const headers = serviceCfg.api_key ? { Authorization: `Bearer ${serviceCfg.api_key}` } : {};
  const attempts = [];
  const primary = await attemptRequest({
    fetcher,
    url: primaryRequestUrl(endpointCfg, query),
    headers,
    attempts,
    readOptions,
  });
  if (primary?.res.ok) return success(primary, { source: "primary" });
  if (primary && primary.res.status >= 400 && primary.res.status < 500) {
    return failure(failureCode.UPSTREAM_FAILED, tWebSearch(locale, "upstreamRejected"), {
      httpStatus: primary.res.status,
      attempts,
      data: primary.data,
    });
  }

  const registryAttempt = { url: SEARX_INSTANCES_YAML_URL };
  attempts.push(registryAttempt);
  const instances = await loadRemoteInstances(fetcher, registryAttempt);
  const resolved = resolveCandidateInstances({
    failureCode,
    customParam: custom_param,
    instances,
    locale,
    attempts,
  });
  if (resolved.failure) return resolved.failure;
  for (const base of resolved.candidates) {
    const url = fallbackSearchUrl(base, query);
    const outcome = await attemptRequest({ fetcher, url, headers: {}, attempts, readOptions });
    if (outcome?.res.ok) {
      return success(outcome, {
        source: "searx_fallback",
        fallbackUrl: url,
        searxInstancesSource: SEARX_INSTANCES_YAML_URL,
        attempts,
      });
    }
  }
  return failure(failureCode.UPSTREAM_UNREACHABLE, tWebSearch(locale, "allProvidersFailed"), {
    attempts,
  });
}
