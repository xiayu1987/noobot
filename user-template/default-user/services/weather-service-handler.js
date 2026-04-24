function formatHint(endpointCfg = {}) {
  return {
    queryString: endpointCfg?.query_string_format || '{"city":"Chongqing","format":"j1"}',
    body: endpointCfg?.body_format || "{}",
  };
}

export default async function weatherServiceHandler({
  endpointCfg,
  custom_param = "",
  queryString = {},
  body = {},
  fetch,
}) {
  const hint = formatHint(endpointCfg);
  const city =
    String(queryString?.city || body?.city || "Chongqing").trim() || "Chongqing";
  const outputFormat =
    String(
      custom_param ||
      queryString?.custom_param ||
      body?.custom_param ||
      endpointCfg?.custom_param_format ||
      "j1",
    ).trim() || "j1";
  const baseUrl = String(endpointCfg?.url || "https://wttr.in").trim();
  const targetUrl = `${baseUrl.replace(/\/+$/, "")}/${encodeURIComponent(city)}?format=${encodeURIComponent(outputFormat)}`;
  const response = await fetch(targetUrl, { method: "GET" });
  const data = await response.json();

  return {
    ok: response.ok,
    status: response.status,
    statusText: response.statusText,
    expectedFormat: hint,
    custom_param: outputFormat,
    request: { city, format: outputFormat, url: targetUrl },
    data,
  };
}
