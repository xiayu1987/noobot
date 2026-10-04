/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
function formatHint(endpointCfg = {}) {
  return {
    queryString: endpointCfg?.query_string_format || '{"city":"Chongqing","format":"j1"}',
    body: endpointCfg?.body_format || "{}",
  };
}

function firstEntry(list) {
  return Array.isArray(list) ? list[0] || {} : {};
}

function toText(value) {
  return String(value || "");
}

function firstLabel(list) {
  return toText(list?.[0]?.value);
}

function pickTextFields(source, mapping) {
  return Object.fromEntries(
    Object.entries(mapping).map(([outputKey, sourceKey]) => [outputKey, toText(source[sourceKey])]),
  );
}

function pickLocation(nearest, city) {
  return {
    query_city: toText(city),
    area: firstLabel(nearest.areaName),
    region: firstLabel(nearest.region),
    country: firstLabel(nearest.country),
    ...pickTextFields(nearest, { latitude: "latitude", longitude: "longitude" }),
  };
}

function pickCurrent(current) {
  return {
    ...pickTextFields(current, {
      observation_time: "observation_time",
      local_obs_time: "localObsDateTime",
    }),
    weather: firstLabel(current.weatherDesc),
    ...pickTextFields(current, {
      temp_c: "temp_C",
      feels_like_c: "FeelsLikeC",
      humidity: "humidity",
      wind_kmph: "windspeedKmph",
      wind_dir: "winddir16Point",
      pressure: "pressure",
      uv_index: "uvIndex",
      visibility_km: "visibility",
    }),
  };
}

function pickToday(today) {
  const astronomy = firstEntry(today.astronomy);
  return {
    ...pickTextFields(today, {
      date: "date",
      max_temp_c: "maxtempC",
      min_temp_c: "mintempC",
      avg_temp_c: "avgtempC",
    }),
    ...pickTextFields(astronomy, { sunrise: "sunrise", sunset: "sunset" }),
  };
}

function pickWeatherSummary(raw = {}, city = "") {
  return {
    location: pickLocation(firstEntry(raw?.nearest_area), city),
    current: pickCurrent(firstEntry(raw?.current_condition)),
    today: pickToday(firstEntry(raw?.weather)),
  };
}

export default async function weatherServiceHandler({
  runtime,
  endpointCfg,
  custom_param = "",
  queryString = {},
  body = {},
}) {
  const fetcher = runtime?.sharedTools?.fetch;
  if (typeof fetcher !== "function") {
    return {
      ok: false,
      error: "fetch missing in runtime.sharedTools",
    };
  }
  const hint = formatHint(endpointCfg);
  const city = String(queryString?.city || body?.city || "Chongqing").trim() || "Chongqing";
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
