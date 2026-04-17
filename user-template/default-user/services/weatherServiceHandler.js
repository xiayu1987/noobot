function formatHint(endpointCfg = {}) {
  return {
    queryString:
      endpointCfg?.["query-string-format"] ||
      '{"city":"Chongqing","days":3,"language":"zh"}',
    body: endpointCfg?.["body-format"] || "{}",
  };
}

export default async function weatherServiceHandler({
  endpointCfg,
  queryString = {},
  body,
  fetch,
}) {
  const hint = formatHint(endpointCfg);
  if (body !== undefined && body !== null && String(body).trim() !== "") {
    return {
      ok: false,
      error: "body 格式错误：该接口仅支持 queryString。",
      expectedFormat: hint,
    };
  }

  const city = String(queryString?.city || "").trim();
  const days = Math.max(1, Math.min(7, Number(queryString?.days || 3)));
  const language = String(queryString?.language || "zh").trim() || "zh";
  if (!city) {
    return {
      ok: false,
      error: "queryString 格式错误：缺少 city。",
      expectedFormat: hint,
    };
  }

  const geocodeUrl = new URL(String(endpointCfg?.url || ""));
  geocodeUrl.searchParams.set("name", city);
  geocodeUrl.searchParams.set("count", "1");
  geocodeUrl.searchParams.set("language", language);
  geocodeUrl.searchParams.set("format", "json");
  const geocodeRes = await fetch(geocodeUrl.toString(), { method: "GET" });
  const geo = await geocodeRes.json();
  const loc = Array.isArray(geo?.results) ? geo.results[0] : null;
  if (!loc?.latitude || !loc?.longitude) {
    return {
      ok: false,
      error: `未找到城市: ${city}`,
      expectedFormat: hint,
      data: geo,
    };
  }

  const forecastUrl = new URL("https://api.open-meteo.com/v1/forecast");
  forecastUrl.searchParams.set("latitude", String(loc.latitude));
  forecastUrl.searchParams.set("longitude", String(loc.longitude));
  forecastUrl.searchParams.set(
    "current",
    "temperature_2m,relative_humidity_2m,precipitation,weather_code",
  );
  forecastUrl.searchParams.set(
    "daily",
    "weather_code,temperature_2m_max,temperature_2m_min,precipitation_sum",
  );
  forecastUrl.searchParams.set("timezone", "auto");
  forecastUrl.searchParams.set("forecast_days", String(days));
  const forecastRes = await fetch(forecastUrl.toString(), { method: "GET" });
  const forecast = await forecastRes.json();

  return {
    ok: geocodeRes.ok && forecastRes.ok,
    status: forecastRes.status,
    statusText: forecastRes.statusText,
    data: {
      location: {
        city: loc.name,
        country: loc.country,
        admin1: loc.admin1,
        latitude: loc.latitude,
        longitude: loc.longitude,
      },
      current: forecast?.current || {},
      daily: forecast?.daily || {},
      units: forecast?.current_units || {},
      timezone: forecast?.timezone || "",
    },
  };
}
