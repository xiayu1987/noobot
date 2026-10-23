/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
export class ChannelEventJournal {
  constructor({ maxEvents }) {
    if (!Number.isInteger(maxEvents) || maxEvents < 1) {
      throw new TypeError("channel event journal requires positive integer maxEvents");
    }
    this.maxEvents = maxEvents;
    this.sequence = 0;
    this.events = [];
  }

  append(event, data) {
    const envelope = { sequence: ++this.sequence, event, data };
    this.events.push(envelope);
    if (this.events.length > this.maxEvents) {
      this.events = this.events.slice(-this.maxEvents);
    }
    return envelope;
  }

  transient(event, data) {
    return { sequence: this.sequence, event, data };
  }

  after(sequence) {
    return this.events.filter((event) => event.sequence > sequence);
  }

  reset() {
    this.sequence = 0;
    this.events = [];
  }
}
