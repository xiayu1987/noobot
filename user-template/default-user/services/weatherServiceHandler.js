function formatHint(endpointCfg = {}) {
  return {
    queryString:
      endpointCfg?.["query-string-format"] ||
      '{"city":"Chongqing","format":"j1"}',
    body: endpointCfg?.["body-format"] || "{}",
  };
}

export default async function weatherServiceHandler({
  endpointCfg,
  queryString = {},
  body = {},
  fetch,
}) {
  const hint = formatHint(endpointCfg);
  const city =
    String(queryString?.city || body?.city || "Chongqing").trim() || "Chongqing";
  const format = String(queryString?.format || body?.format || "j1").trim() || "j1";
  const baseUrl = String(endpointCfg?.url || "https://wttr.in").trim();
  const targetUrl = `${baseUrl.replace(/\/+$/, "")}/${encodeURIComponent(city)}?format=${encodeURIComponent(format)}`;
  const response = await fetch(targetUrl, { method: "GET" });
  const data = await response.json();

  return {
    ok: response.ok,
    status: response.status,
    statusText: response.statusText,
    expectedFormat: hint,
    request: { city, format, url: targetUrl },
    data,
  };
}
