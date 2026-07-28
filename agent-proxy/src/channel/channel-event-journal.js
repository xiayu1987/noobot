/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

export class ChannelEventJournal {
  constructor({ maxEvents = 0 } = {}) {
    this.maxEvents = Math.max(0, Number(maxEvents || 0));
    this.sequence = 0;
    this.events = [];
  }

  append(event = "message", data = {}) {
    const envelope = {
      sequence: ++this.sequence,
      event: String(event || "message").trim() || "message",
      data: data && typeof data === "object" ? data : {},
    };
    this.events.push(envelope);
    if (this.maxEvents > 0 && this.events.length > this.maxEvents) {
      this.events = this.events.slice(-this.maxEvents);
    }
    return envelope;
  }

  after(sequence = 0) {
    const cursor = Math.max(0, Number(sequence || 0));
    return this.events.filter((event) => Number(event?.sequence || 0) > cursor);
  }

  reset() {
    this.sequence = 0;
    this.events = [];
  }
}
