function formatHint(endpointCfg = {}) {
  return {
    queryString: endpointCfg?.query_string_format || "search=关键词",
    body: endpointCfg?.body_format || "{}",
  };
}

const DEFAULT_SEARX_INSTANCES = ["https://searx.be"];
const SEARX_INSTANCES_YAML_URL =
  "https://raw.githubusercontent.com/searxng/searx-instances/master/searxinstances/instances.yml";
const REMOTE_INSTANCE_CACHE_TTL_MS = 60 * 60 * 1000;
let remoteInstanceCache = {
  fetchedAt: 0,
  instances: [],
};

function parseSearxInstancesYaml(text = "") {
  const lines = String(text || "").split(/\r?\n/);
  const out = [];
  for (const raw of lines) {
    const line = String(raw || "").trim();
    if (!line || line.startsWith("#")) continue;
    // 示例：https://search.unredacted.org: {}
    const matched = line.match(/^(https?:\/\/.+):\s*\{\s*\}\s*$/);
    if (!matched?.[1]) continue;
    try {
      const normalized = new URL(matched[1]).toString().replace(/\/+$/, "");
      if (!out.includes(normalized)) out.push(normalized);
    } catch {
      // ignore invalid line
    }
  }
  return out;
}

function normalizeInstanceList(list = []) {
  const out = [];
  for (const item of Array.isArray(list) ? list : []) {
    try {
      const normalized = new URL(String(item || "").trim())
        .toString()
        .replace(/\/+$/, "");
      if (normalized && !out.includes(normalized)) out.push(normalized);
    } catch {
      // ignore invalid instance
    }
  }
  return out;
}

async function getRemoteSearxInstances(fetcher) {
  const now = Date.now();
  if (
    Array.isArray(remoteInstanceCache.instances) &&
    remoteInstanceCache.instances.length &&
    now - Number(remoteInstanceCache.fetchedAt || 0) < REMOTE_INSTANCE_CACHE_TTL_MS
  ) {
    return remoteInstanceCache.instances;
  }
  try {
    const res = await fetcher(SEARX_INSTANCES_YAML_URL, { method: "GET" });
    if (!res.ok) return [];
    const yamlText = await res.text();
    const parsed = parseSearxInstancesYaml(yamlText);
    if (!parsed.length) return [];
    remoteInstanceCache = {
      fetchedAt: now,
      instances: parsed,
    };
    return parsed;
  } catch {
    return [];
  }
}

async function parseResponseData(res, { textCleaner = null, requestUrl = "" } = {}) {
  const contentType = res.headers.get("content-type") || "";
  const isJson = contentType.includes("application/json");
  if (isJson) return await res.json();
  const text = await res.text();
  const cleaned = textCleaner?.cleanAny
    ? textCleaner.cleanAny(text, { contentType, url: requestUrl })
    : text;
  if (cleaned === text) return text;
  return {
    type: "cleaned_text",
    text: String(cleaned || ""),
    original_length: text.length,
    cleaned_length: String(cleaned || "").length,
    content_type: contentType,
  };
}

async function requestWithFallback({
  fetcher,
  textCleaner = null,
  primaryUrl = "",
  reqHeaders = {},
  query = "",
  customParam = "",
  fallbackInstances = [],
}) {
  const attemptedFallbackUrls = [];
  try {
    const res = await fetcher(primaryUrl, {
      method: "GET",
      headers: reqHeaders,
    });
    if (res.ok) {
      return {
        ok: true,
        status: res.status,
        statusText: res.statusText,
        data: await parseResponseData(res, {
          textCleaner,
          requestUrl: primaryUrl,
        }),
        source: "primary",
      };
    }
    // 4xx 通常是请求参数问题，不走兜底
    if (res.status >= 400 && res.status < 500) {
      return {
        ok: false,
        status: res.status,
        statusText: res.statusText,
        data: await parseResponseData(res, {
          textCleaner,
          requestUrl: primaryUrl,
        }),
        source: "primary",
      };
    }
  } catch {
    // primary 不可访问，走兜底
  }

  const normalizedCustomParam = String(customParam || "").trim();
  let candidateInstances = [...fallbackInstances];
  if (normalizedCustomParam) {
    let normalizedUrl = "";
    try {
      normalizedUrl = new URL(normalizedCustomParam).toString().replace(/\/+$/, "");
    } catch {
      return {
        ok: false,
        status: 0,
        statusText: "invalid_custom_param",
        error: "custom_param 必须是有效的实例 URL",
        data: null,
        source: "fallback_failed",
        attemptedFallbackUrls,
      };
    }
    if (!fallbackInstances.includes(normalizedUrl)) {
      return {
        ok: false,
        status: 0,
        statusText: "invalid_custom_param_instance",
        error: "custom_param 不在 SEARX 实例列表中",
        data: null,
        source: "fallback_failed",
        attemptedFallbackUrls,
      };
    }
    candidateInstances = [normalizedUrl];
  }

  for (const base of candidateInstances) {
    try {
      const target = new URL("/search", String(base).replace(/\/+$/, "/"));
      target.searchParams.set("q", query);
      target.searchParams.set("format", "json");
      attemptedFallbackUrls.push(target.toString());
      const res = await fetcher(target.toString(), { method: "GET" });
      const data = await parseResponseData(res, {
        textCleaner,
        requestUrl: target.toString(),
      });
      if (res.ok) {
        return {
          ok: true,
          status: res.status,
          statusText: res.statusText,
          data,
          source: "searx_fallback",
          fallbackUrl: target.toString(),
          attemptedFallbackUrls,
        };
      }
    } catch {
      // try next
    }
  }

  return {
    ok: false,
    status: 0,
    statusText: "service_unreachable",
    data: null,
    source: "fallback_failed",
    attemptedFallbackUrls,
  };
}

export default async function webSearchServiceHandler({
  agentContext = null,
  endpointCfg,
  serviceCfg,
  custom_param = "",
  queryString = {},
  body,
}) {
  const fetcher = agentContext?.runtime?.sharedTools?.fetch;
  if (typeof fetcher !== "function") {
    return {
      ok: false,
      error: "fetch missing in agentContext.runtime.sharedTools",
    };
  }
  const textCleaner = agentContext?.runtime?.sharedTools?.textCleaner || null;
  const hint = formatHint(endpointCfg);
  if (body !== undefined && body !== null && String(body).trim() !== "") {
    return {
      ok: false,
      error: "body 格式错误：此服务不接受 body，请使用 queryString。",
      expectedFormat: hint,
    };
  }

  const search = String(queryString?.search || queryString?.q || "").trim();
  const outputFormat =
    String(
      endpointCfg?.custom_param_format ||
      "json",
    ).trim() ||
    "json";
  if (!search) {
    return {
      ok: false,
      error: "queryString 格式错误：缺少 search（或 q）。",
      expectedFormat: hint,
    };
  }

  const url = new URL(String(endpointCfg.url || ""));
  url.searchParams.set("q", search);
  url.searchParams.set("format", outputFormat);

  const reqHeaders = {};
  const apiKey = String(serviceCfg?.api_key || "").trim();
  if (apiKey) reqHeaders.Authorization = `Bearer ${apiKey}`;

  const fallbackInstancesFromConfig = normalizeInstanceList(
    Array.isArray(serviceCfg?.fallback_instances)
      ? serviceCfg.fallback_instances
      : DEFAULT_SEARX_INSTANCES,
  );
  const remoteInstances = await getRemoteSearxInstances(fetcher);
  const fallbackInstances = normalizeInstanceList([
    ...(remoteInstances || []),
    ...fallbackInstancesFromConfig,
  ]);
  const result = await requestWithFallback({
    fetcher,
    textCleaner,
    primaryUrl: url.toString(),
    reqHeaders,
    query: search,
    customParam: custom_param,
    fallbackInstances,
  });

  return {
    ok: result.ok,
    status: result.status,
    statusText: result.statusText,
    source: result.source,
    custom_param: outputFormat,
    ...(result.source !== "primary"
      ? {
          searx_instances_source: {
            type: "searx_instances_source_url",
            label: "SEARX 实例来源地址",
            url: SEARX_INSTANCES_YAML_URL,
          },
          fallback_attempted_urls: result.attemptedFallbackUrls || [],
        }
      : {}),
    ...(result.fallbackUrl ? { fallbackUrl: result.fallbackUrl } : {}),
    data: result.data,
  };
}
