/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { ensureHarnessBucket } from "./deps.js";
import { resolveLatestCompleteSummaryText } from "../shared/plan/latest-summary-context.js";
import {
  mergeTransferEnvelopes,
  normalizeTransferEnvelopes,
} from "@noobot/semantic-transfer-protocol";

export function shouldSaveSummaryToAttachment(meta = {}) {
  return meta?.harness?.summaryDetailSaveToAttachment === true;
}

export function resolvePreviousSummaryContextText(ctx = {}) {
  return resolveLatestCompleteSummaryText({ ctx });
}

export function recordSummaryTransferEnvelopes(ctx = {}, transferPayload = {}) {
  const holder = ensureHarnessBucket(ctx);
  if (!holder) return [];
  const { bucket } = holder;
  const envelopes = normalizeTransferEnvelopes(transferPayload.transferEnvelopes).filter(
    (envelope) => envelope.payload.mode === "attachment",
  );
  bucket.summaryTransferEnvelopes = mergeTransferEnvelopes(
    bucket.summaryTransferEnvelopes,
    envelopes,
  );
  return bucket.summaryTransferEnvelopes;
}
