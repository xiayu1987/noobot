function formatHint(endpointCfg = {}) {
  return {
    queryString: endpointCfg?.query_string_format || '{"city":"Chongqing","format":"j1"}',
    body: endpointCfg?.body_format || "{}",
  };
}

function pickWeatherSummary(raw = {}, city = "") {
  const current = Array.isArray(raw?.current_condition)
    ? raw.current_condition[0] || {}
    : {};
  const nearest = Array.isArray(raw?.nearest_area)
    ? raw.nearest_area[0] || {}
    : {};
  const today = Array.isArray(raw?.weather) ? raw.weather[0] || {} : {};
  const astronomy = Array.isArray(today?.astronomy) ? today.astronomy[0] || {} : {};

  return {
    location: {
      query_city: String(city || ""),
      area: String(nearest?.areaName?.[0]?.value || ""),
      region: String(nearest?.region?.[0]?.value || ""),
      country: String(nearest?.country?.[0]?.value || ""),
      latitude: String(nearest?.latitude || ""),
      longitude: String(nearest?.longitude || ""),
    },
    current: {
      observation_time: String(current?.observation_time || ""),
      local_obs_time: String(current?.localObsDateTime || ""),
      weather: String(current?.weatherDesc?.[0]?.value || ""),
      temp_c: String(current?.temp_C || ""),
      feels_like_c: String(current?.FeelsLikeC || ""),
      humidity: String(current?.humidity || ""),
      wind_kmph: String(current?.windspeedKmph || ""),
      wind_dir: String(current?.winddir16Point || ""),
      pressure: String(current?.pressure || ""),
      uv_index: String(current?.uvIndex || ""),
      visibility_km: String(current?.visibility || ""),
    },
    today: {
      date: String(today?.date || ""),
      max_temp_c: String(today?.maxtempC || ""),
      min_temp_c: String(today?.mintempC || ""),
      avg_temp_c: String(today?.avgtempC || ""),
      sunrise: String(astronomy?.sunrise || ""),
      sunset: String(astronomy?.sunset || ""),
    },
  };
}

export default async function weatherServiceHandler({
  agentContext = null,
  endpointCfg,
  custom_param = "",
  queryString = {},
  body = {},
}) {
  const fetcher = agentContext?.runtime?.sharedTools?.fetch;
  if (typeof fetcher !== "function") {
    return {
      ok: false,
      error: "fetch missing in agentContext.runtime.sharedTools",
    };
  }
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
  const response = await fetcher(targetUrl, { method: "GET" });
  const rawData = await response.json();
  const data = pickWeatherSummary(rawData, city);

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
