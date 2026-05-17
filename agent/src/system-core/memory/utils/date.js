/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

export function toTs(value) {
  const timestamp = new Date(value || 0).getTime();
  return Number.isNaN(timestamp) ? 0 : timestamp;
}

export function toDateKey(value = "") {
  const dateObj = new Date(value || Date.now());
  if (Number.isNaN(dateObj.getTime())) return new Date().toISOString().slice(0, 10);
  return dateObj.toISOString().slice(0, 10);
}

export function toIsoWeekInfo(value = "") {
  const dateObj = new Date(value || Date.now());
  if (Number.isNaN(dateObj.getTime())) {
    return { weekYear: 1970, weekNumber: 1, weekLabel: "1970-第1周" };
  }
  const utcDate = new Date(
    Date.UTC(dateObj.getUTCFullYear(), dateObj.getUTCMonth(), dateObj.getUTCDate()),
  );
  const day = utcDate.getUTCDay() || 7;
  utcDate.setUTCDate(utcDate.getUTCDate() + 4 - day);
  const weekYear = utcDate.getUTCFullYear();
  const yearStart = new Date(Date.UTC(weekYear, 0, 1));
  const weekNumber = Math.ceil((((utcDate - yearStart) / 86400000) + 1) / 7);
  return {
    weekYear,
    weekNumber,
    weekKey: `${weekYear}-W${String(weekNumber).padStart(2, "0")}`,
    weekLabel: `${weekYear}-第${weekNumber}周`,
  };
}
