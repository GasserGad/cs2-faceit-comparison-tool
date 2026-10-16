// Caps how many FACEIT requests run at once and how many may wait in line.
// When the line is full, new work is rejected immediately (load shedding)
// instead of piling up in memory during a traffic spike or a flood.

import { upstreamBusy } from "./errors.js";

export class ConcurrencyLimiter {
  /**
   * @param {{ concurrency: number, queueLimit: number }} options
   */
  constructor({ concurrency, queueLimit }) {
    this.concurrency = concurrency;
    this.queueLimit = queueLimit;
    this.active = 0;
    /** @type {Array<() => void>} */
    this.queue = [];
  }

  /**
   * @template T
   * @param {() => Promise<T>} task
   * @returns {Promise<T>}
   */
  async run(task) {
    if (this.active >= this.concurrency) {
      if (this.queue.length >= this.queueLimit) {
        throw upstreamBusy(15);
      }
      // The finishing task hands its slot straight to us (see finally below),
      // so `active` is already counted for this task when we wake up.
      await new Promise((resolve) => this.queue.push(() => resolve(undefined)));
    } else {
      this.active += 1;
    }
    try {
      return await task();
    } finally {
      const next = this.queue.shift();
      if (next) {
        next();
      } else {
        this.active -= 1;
      }
    }
  }
}
