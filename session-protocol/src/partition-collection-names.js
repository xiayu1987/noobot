/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { SESSION_COLLECTION_NAMES } from "./session-collection-names.js";

export const PARTITION_MESSAGE_CONTENT = "messageContent";
export const PARTITION_TOOL_PAIR_RESULTS = "toolPairResults";
export const PARTITION_HISTORICAL_OPERATIONS = "historicalOperations";
export const PARTITION_SESSION_ARTIFACT_EVENTS = "sessionArtifactEvents";
export const PARTITION_OUTBOX_DELIVERY_COMPACTIONS = "outboxDeliveryCompactions";

export const PARTITION_COLLECTION_NAMES = Object.freeze([
  ...SESSION_COLLECTION_NAMES,
  PARTITION_MESSAGE_CONTENT,
  PARTITION_TOOL_PAIR_RESULTS,
  PARTITION_HISTORICAL_OPERATIONS,
  PARTITION_SESSION_ARTIFACT_EVENTS,
  PARTITION_OUTBOX_DELIVERY_COMPACTIONS,
]);
