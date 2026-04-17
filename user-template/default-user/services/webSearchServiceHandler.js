function formatHint(endpointCfg = {}) {
  return {
    queryString: endpointCfg?.["query-string-format"] || "search=关键词",
    body: endpointCfg?.["body-format"] || "{}",
  };
}

export default async function webSearchServiceHandler({
  endpointCfg,
  serviceCfg,
  queryString = {},
  body,
  fetch,
}) {
  const hint = formatHint(endpointCfg);
  if (body !== undefined && body !== null && String(body).trim() !== "") {
    return {
      ok: false,
      error: "body 格式错误：此服务不接受 body，请使用 queryString。",
      expectedFormat: hint,
    };
  }

  const search = String(queryString?.search || queryString?.q || "").trim();
  if (!search) {
    return {
      ok: false,
      error: "queryString 格式错误：缺少 search（或 q）。",
      expectedFormat: hint,
    };
  }

  const url = new URL(String(endpointCfg.url || ""));
  url.searchParams.set("q", search);

  const reqHeaders = {};
  const apiKey = String(serviceCfg?.api_key || "").trim();
  if (apiKey) reqHeaders.Authorization = `Bearer ${apiKey}`;

  const res = await fetch(url.toString(), {
    method: "GET",
    headers: reqHeaders,
  });
  const contentType = res.headers.get("content-type") || "";
  const isJson = contentType.includes("application/json");

  return {
    ok: res.ok,
    status: res.status,
    statusText: res.statusText,
    data: isJson ? await res.json() : await res.text(),
  };
}
