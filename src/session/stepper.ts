/**
 * Turns uneven real time (display frames) into an exact number of simulation
 * ticks.
 *
 * The display runs as fast as the monitor allows; the simulation runs at a
 * fixed rate. Each frame, feed in the time that has passed: the stepper says
 * how many ticks are due and how far the display is between the last tick and
 * the next one, so drawing can blend between the two and stay smooth.
 */
export class FixedStepper {
  readonly tickMs: number;
  private accumulatedMs = 0;

  /**
   * @param maxTicksPerAdvance  After a long stall (a background tab, a slow
   *   frame) the backlog is cut to this many ticks, so the game slows down
   *   briefly instead of freezing while it tries to catch up.
   */
  constructor(
    tickRate: number,
    private readonly maxTicksPerAdvance = 5,
  ) {
    if (!(tickRate > 0)) throw new RangeError('tickRate must be positive');
    this.tickMs = 1000 / tickRate;
  }

  /** Adds elapsed real time and returns how many ticks to run now. */
  advance(elapsedMs: number): number {
    if (elapsedMs > 0) this.accumulatedMs += elapsedMs;
    let ticks = Math.floor(this.accumulatedMs / this.tickMs);
    this.accumulatedMs -= ticks * this.tickMs;
    if (ticks > this.maxTicksPerAdvance) ticks = this.maxTicksPerAdvance;
    return ticks;
  }

  /** From 0 to 1: how far real time has moved past the latest tick. */
  get alpha(): number {
    return Math.min(1, Math.max(0, this.accumulatedMs / this.tickMs));
  }

  reset(): void {
    this.accumulatedMs = 0;
  }
}
