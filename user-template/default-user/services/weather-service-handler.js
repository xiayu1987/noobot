/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

function firstEntry(list) {
  if (!Array.isArray(list) || list.length === 0) return {};
  return list[0];
}

function firstLabel(list) {
  return String(firstEntry(list).value ?? "");
}

function pickTextFields(source, mapping) {
  return Object.fromEntries(
    Object.entries(mapping).map(([outputKey, sourceKey]) => [
      outputKey,
      String(source[sourceKey] ?? ""),
    ]),
  );
}

function pickLocation(nearest, city) {
  return {
    query_city: city,
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
  return {
    ...pickTextFields(today, {
      date: "date",
      max_temp_c: "maxtempC",
      min_temp_c: "mintempC",
      avg_temp_c: "avgtempC",
    }),
    ...pickTextFields(firstEntry(today.astronomy), { sunrise: "sunrise", sunset: "sunset" }),
  };
}

function pickWeatherSummary(raw, city) {
  return {
    location: pickLocation(firstEntry(raw.nearest_area), city),
    current: pickCurrent(firstEntry(raw.current_condition)),
    today: pickToday(firstEntry(raw.weather)),
  };
}

function inputInvalid(failureCode, error, endpointCfg) {
  return {
    ok: false,
    error,
    code: failureCode.INPUT_INVALID,
    output: {
      expectedFormat: {
        queryString: String(endpointCfg.query_string_format ?? ""),
        body: String(endpointCfg.body_format ?? ""),
      },
    },
  };
}

function resolveOutputFormat(customParam, endpointCfg) {
  const fromParam = String(customParam ?? "").trim();
  if (fromParam) return fromParam;
  return String(endpointCfg.custom_param_format ?? "").trim();
}

export default async function weatherServiceHandler({
  runtime,
  failureCode,
  endpointCfg,
  custom_param,
  queryString,
}) {
  const city = queryString === undefined ? "" : String(queryString.city ?? "").trim();
  if (!city) return inputInvalid(failureCode, "queryString.city is required", endpointCfg);
  const outputFormat = resolveOutputFormat(custom_param, endpointCfg);
  if (!outputFormat) {
    return inputInvalid(
      failureCode,
      "custom_param or endpoint custom_param_format is required",
      endpointCfg,
    );
  }
  const baseUrl = String(endpointCfg.url).trim().replace(/\/+$/, "");
  const targetUrl = `${baseUrl}/${encodeURIComponent(city)}?format=${encodeURIComponent(outputFormat)}`;
  const response = await runtime.sharedTools.fetch(targetUrl, { method: "GET" });
  const request = { city, format: outputFormat, url: targetUrl };
  if (!response.ok) {
    return {
      ok: false,
      error: `weather upstream responded ${response.status} ${response.statusText}`.trim(),
      code: failureCode.UPSTREAM_FAILED,
      output: { httpStatus: response.status, request, body: await response.text() },
    };
  }
  return {
    ok: true,
    output: {
      httpStatus: response.status,
      output_format: outputFormat,
      request,
      data: pickWeatherSummary(await response.json(), city),
    },
  };
}
